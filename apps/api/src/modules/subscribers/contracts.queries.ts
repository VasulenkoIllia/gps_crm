import {
  addDays,
  contractStatus,
  CONTRACT_EXPIRY_DAYS,
  decodeListCursor,
  encodeListCursor,
  isContractExpiring,
  normalizeName,
  type Contract,
  type ContractList,
  type ContractListQuery,
  type ContractStatus,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";
import { findLatestFileNames } from "../../core/files/files.repository.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { CONTRACT_OWNER } from "./contracts.files.js";
import { scopedContract } from "./contracts.repository.js";
import { scopedPayer } from "./payers.repository.js";
import { escapeLike, MIN_NAME_SEARCH } from "./subscribers.queries.js";
import { subscriberWhere } from "./subscribers.repository.js";

// Who a search names: a person narrows it long before this
const PARTY_MATCHES_MAX = 500;
const CONTRACTS_OF_CLIENT_MAX = 500;
const DIGITS_ONLY = /^\d+$/;
const CODE_DIGITS = /^\d{5,15}$/;

type Where = Prisma.ContractWhereInput;

const ROW_SELECT = {
  id: true,
  version: true,
  number: true,
  signedOn: true,
  validUntil: true,
  terminatedOn: true,
  note: true,
  archivedAt: true,
  subscriber: { select: { id: true, name: true, code: true } },
  payer: { select: { id: true, name: true, taxId: true } },
} satisfies Prisma.ContractSelect;

type RawRow = Prisma.ContractGetPayload<{ select: typeof ROW_SELECT }>;

function toContract(row: RawRow, fileName: string | null, today: string): Contract {
  const dates = {
    signedOn: fromDbDate(row.signedOn),
    validUntil: fromDbDate(row.validUntil),
    terminatedOn: row.terminatedOn && fromDbDate(row.terminatedOn),
  };
  return {
    id: row.id,
    version: row.version,
    number: row.number,
    subscriber: { ...row.subscriber, code: Number(row.subscriber.code) },
    payer: row.payer,
    ...dates,
    note: row.note,
    status: contractStatus(dates, today),
    isExpiring: isContractExpiring(dates, today),
    fileName,
    isArchived: row.archivedAt !== null,
  };
}

// The same conditions as contractStatus, so the filter and the tag cannot disagree
function statusWhere(status: ContractStatus, today: string): Where {
  const day = toDbDate(today);
  if (status === "terminated") return { terminatedOn: { not: null } };
  if (status === "pending") return { terminatedOn: null, signedOn: { gt: day } };
  if (status === "expired") return { terminatedOn: null, signedOn: { lte: day }, validUntil: { lt: day } };
  return { terminatedOn: null, signedOn: { lte: day }, validUntil: { gte: day } };
}

function expiringWhere(today: string): Where {
  const edge = toDbDate(addDays(today, CONTRACT_EXPIRY_DAYS));
  return { AND: [statusWhere("active", today), { validUntil: { lt: edge } }] };
}

// In steps, as the search of clients: `id IN (...)` next to an OR reads the matches, a join there reads the table
async function searchWhere(db: DbOrTx, text: string, scope: RecordScope): Promise<Where> {
  const norm = normalizeName(text);
  const like = escapeLike(norm);
  const isDigits = DIGITS_ONLY.test(text);
  const isLong = norm.length >= MIN_NAME_SEARCH;
  const clientWhere: Prisma.SubscriberWhereInput[] = [
    { legacyCode: text },
    ...(CODE_DIGITS.test(text) ? [{ code: BigInt(text) }] : []),
    ...(isLong ? [{ nameNorm: { contains: like } }] : []),
  ];
  const payerWhere: Prisma.PayerWhereInput[] = [
    ...(isDigits ? [{ taxId: { startsWith: text } }] : []),
    ...(isLong ? [{ nameNorm: { contains: like } }] : []),
  ];
  const [clients, payers] = await Promise.all([
    // Live ones, as the search indexes are, and this person's: others would use up the limit of matches
    db.subscriber.findMany({
      where: { ...subscriberWhere(scope), archivedAt: null, OR: clientWhere },
      take: PARTY_MATCHES_MAX,
      select: { id: true },
    }),
    db.payer.findMany({
      where: { ...scopedPayer(scope), archivedAt: null, OR: payerWhere },
      take: PARTY_MATCHES_MAX,
      select: { id: true },
    }),
  ]);
  return {
    OR: [
      { numberNorm: isLong ? { contains: like } : { equals: norm } },
      { subscriberId: { in: clients.map((client) => client.id) } },
      { payerId: { in: payers.map((payer) => payer.id) } },
    ],
  };
}

function filtersWhere(query: ContractListQuery, today: string): Where {
  return {
    archivedAt: null,
    ...(query.status ? statusWhere(query.status, today) : {}),
    ...(query.subscriberId ? { subscriberId: query.subscriberId } : {}),
    ...(query.signedFrom || query.signedTo
      ? {
          signedOn: {
            ...(query.signedFrom ? { gte: toDbDate(query.signedFrom) } : {}),
            ...(query.signedTo ? { lte: toDbDate(query.signedTo) } : {}),
          },
        }
      : {}),
  };
}

// «Спливають» read soonest first; everything else newest first, as a person looks for what was signed last
function orderOf(query: ContractListQuery) {
  return query.expiring
    ? { column: "validUntil" as const, past: "gt" as const, from: "gte" as const, order: "asc" as const }
    : { column: "signedOn" as const, past: "lt" as const, from: "lte" as const, order: "desc" as const };
}

function keysetWhere(query: ContractListQuery): Where {
  if (!query.cursor) return {};
  const { column, past, from } = orderOf(query);
  const { value, id } = decodeListCursor(query.cursor);
  const date = toDbDate(value);
  return {
    AND: [
      { [column]: { [from]: date } },
      { OR: [{ [column]: { [past]: date } }, { [column]: date, id: { [past]: id } }] },
    ],
  };
}

async function toPage(db: DbOrTx, rows: RawRow[], today: string): Promise<Contract[]> {
  const ids = rows.map((row) => row.id);
  const names = await findLatestFileNames(db, CONTRACT_OWNER, ids);
  return rows.map((row) => toContract(row, names.get(row.id) ?? null, today));
}

export async function listContracts(
  db: DbOrTx,
  query: ContractListQuery,
  scope: RecordScope,
  today: string,
): Promise<ContractList> {
  const { column, order } = orderOf(query);
  const rows = await db.contract.findMany({
    where: {
      AND: [
        scopedContract(scope),
        filtersWhere(query, today),
        query.expiring ? expiringWhere(today) : {},
        query.q ? await searchWhere(db, query.q, scope) : {},
        keysetWhere(query),
      ],
    },
    orderBy: [{ [column]: order }, { id: order }],
    take: query.limit + 1,
    select: ROW_SELECT,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: await toPage(db, page, today),
    nextCursor:
      rows.length > query.limit && last ? encodeListCursor({ value: fromDbDate(last[column]), id: last.id }) : null,
  };
}

export async function listContractsOf(db: DbOrTx, subscriberId: string, today: string): Promise<ContractList> {
  const rows = await db.contract.findMany({
    where: { subscriberId },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { signedOn: "desc" }, { id: "desc" }],
    take: CONTRACTS_OF_CLIENT_MAX,
    select: ROW_SELECT,
  });
  return { items: await toPage(db, rows, today), nextCursor: null };
}
