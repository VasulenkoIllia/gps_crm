import { normalizeName, type Payer, type PayerList, type PayerSearchQuery } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { escapeLike } from "../../core/db/like.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { scopedPayer, visibleClient } from "./payers.repository.js";
import { MIN_NAME_SEARCH } from "./subscribers.queries.js";

const OTHER_CLIENTS_MAX = 30;
const CONTRACT_NUMBERS_MAX = 30;
const PAYERS_OF_CLIENT_MAX = 200;
const DIGITS_ONLY = /^\d+$/;

const PAYER_VIEW = {
  id: true,
  version: true,
  name: true,
  paymentMethod: true,
  legalName: true,
  taxId: true,
  vchasnoEmail: true,
  detailsContact: true,
  paymentTermsNote: true,
  note: true,
  archivedAt: true,
} satisfies Prisma.PayerSelect;

function viewSelect(ownClientId: string | null, scope: RecordScope) {
  const others = ownClientId ? { NOT: { subscriberId: ownClientId } } : {};
  return {
    ...PAYER_VIEW,
    subscribers: {
      where: { ...others, ...visibleClient(scope) },
      orderBy: { createdAt: "asc" },
      take: OTHER_CLIENTS_MAX,
      select: { subscriber: { select: { id: true, name: true, code: true } } },
    },
    contracts: {
      where: { archivedAt: null, ...visibleClient(scope), ...(ownClientId ? { subscriberId: ownClientId } : {}) },
      orderBy: { id: "desc" },
      take: CONTRACT_NUMBERS_MAX,
      select: { number: true },
    },
  } satisfies Prisma.PayerSelect;
}

type PayerView = Prisma.PayerGetPayload<{ select: ReturnType<typeof viewSelect> }>;

function toPayer({ archivedAt, subscribers, contracts, ...row }: PayerView, objectCount: number): Payer {
  return {
    ...row,
    isArchived: archivedAt !== null,
    otherClients: subscribers.map(({ subscriber }) => ({ ...subscriber, code: Number(subscriber.code) })),
    objectCount,
    contractNumbers: contracts.map((contract) => contract.number),
  };
}

// Apart from the rows and only for this page: a payer search runs on every keystroke, and has no client to narrow it
async function withObjectCounts(
  db: DbOrTx,
  rows: PayerView[],
  ownClientId: string | null,
  scope: RecordScope,
): Promise<Payer[]> {
  const counts = await db.monitoredObject.groupBy({
    by: ["payerId"],
    where: {
      payerId: { in: rows.map((row) => row.id) },
      archivedAt: null,
      ...visibleClient(scope),
      ...(ownClientId ? { subscriberId: ownClientId } : {}),
    },
    _count: { _all: true },
  });
  const byPayer = new Map(counts.map(({ payerId, _count }) => [payerId, _count._all]));
  return rows.map((row) => toPayer(row, byPayer.get(row.id) ?? 0));
}

// payers.md П6, П11: a disconnected object stands on nobody's money, and leaves a payer free to go
export function countWorkingObjects(db: DbOrTx, payerId: string, subscriberId?: string): Promise<number> {
  return db.monitoredObject.count({
    where: { payerId, archivedAt: null, status: { not: "disconnected" }, ...(subscriberId ? { subscriberId } : {}) },
  });
}

export async function listPayersOf(db: DbOrTx, subscriberId: string, scope: RecordScope): Promise<PayerList> {
  const rows = await db.payer.findMany({
    where: { subscribers: { some: { subscriberId } } },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: PAYERS_OF_CLIENT_MAX,
    select: viewSelect(subscriberId, scope),
  });
  return { items: await withObjectCounts(db, rows, subscriberId, scope), nextCursor: null };
}

// As in the lists: a name is looked for from three letters, the rest would read the whole table for nothing
function searchWhere(text: string): Prisma.PayerWhereInput {
  if (DIGITS_ONLY.test(text)) return { taxId: { startsWith: text } };
  const name = normalizeName(text);
  return name.length >= MIN_NAME_SEARCH ? { nameNorm: { contains: escapeLike(name) } } : { id: { in: [] } };
}

// For «Прив'язати наявного» and the hint about the same tax number. Keyset on id: uuidv7 orders by creation
export async function searchPayers(db: DbOrTx, query: PayerSearchQuery, scope: RecordScope): Promise<PayerList> {
  const rows = await db.payer.findMany({
    where: {
      ...scopedPayer(scope),
      archivedAt: null,
      ...(query.q ? searchWhere(query.q) : {}),
      // Under AND: a search too short for anything is a filter on id too, and it must not be overwritten
      ...(query.cursor ? { AND: [{ id: { lt: query.cursor } }] } : {}),
    },
    orderBy: { id: "desc" },
    take: query.limit + 1,
    select: viewSelect(null, scope),
  });
  const page = rows.slice(0, query.limit);
  return {
    items: await withObjectCounts(db, page, null, scope),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
