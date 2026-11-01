import {
  decodeListCursor,
  encodeListCursor,
  normalizeName,
  normalizePhone,
  reverseDigits,
  type DuplicateField,
  type DuplicateList,
  type DuplicatesQuery,
  type ManagerList,
  type ObjectCounts,
  type SubscriberCard,
  type SubscriberCodeCheck,
  type SubscriberCount,
  type SubscriberCountQuery,
  type SubscriberList,
  type SubscriberListItem,
  type SubscriberListQuery,
  type SubscriberSort,
  type TariffVersion,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate } from "../../core/db/dates.js";
import { escapeLike } from "../../core/db/like.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { scopedContact } from "./contacts.repository.js";
import { scopedContract } from "./contracts.repository.js";
import { scopedPayer } from "./payers.repository.js";
import { subscriberWhere } from "./subscribers.repository.js";

const COUNT_CAP = 10_000;
const CODE_DIGITS = /^\d{5,15}$/;
const PHONE_LIKE = /^[\d\s()+-]+$/;
const MIN_PHONE_SEARCH = 4;
export const MIN_NAME_SEARCH = 3;
const EQUIPMENT_MATCHES_MAX = 200;
// A number ending the same way may sit on thousands of contacts, and a person narrows the search long before those
const CONTACT_MATCHES_MAX = 200;
const MANAGERS_MAX = 500;
const HISTORY_MAX = 100;
const DUPLICATES_MAX = 5;

type Where = Prisma.SubscriberWhereInput;

// In two steps on purpose: `id IN (...)` next to an OR reads the matching rows, a subquery there reads the table
async function matchingContacts(db: DbOrTx, where: Prisma.ContactWhereInput): Promise<string[]> {
  const rows = await db.contact.findMany({
    where: { ...where, archivedAt: null },
    take: CONTACT_MATCHES_MAX,
    select: { subscriberId: true },
  });
  return [...new Set(rows.map((row) => row.subscriberId))];
}

// D69: whose object a number stands on. Two steps here as well, by the index of the number, and this module reads the
// tables without their module: the graph keeps equipment out of subscribers, and a read crosses it in a queries file.
async function matchingEquipment(db: DbOrTx, digits: string): Promise<string[]> {
  const reversed = reverseDigits(digits);
  const owner = { object: { select: { subscriberId: true } } };
  const [devices, sims] = await Promise.all([
    db.device.findMany({
      where: { archivedAt: null, OR: [{ imei: { startsWith: digits } }, { imeiRev: { startsWith: reversed } }] },
      take: EQUIPMENT_MATCHES_MAX,
      select: owner,
    }),
    db.sim.findMany({
      where: {
        archivedAt: null,
        OR: [
          { iccid: { startsWith: digits } },
          { iccidRev: { startsWith: reversed } },
          { msisdnRev: { startsWith: reversed } },
        ],
      },
      take: EQUIPMENT_MATCHES_MAX,
      select: { device: { select: owner } },
    }),
  ]);
  const clients = [...devices, ...sims.flatMap((sim) => (sim.device ? [sim.device] : []))];
  return [...new Set(clients.flatMap((row) => (row.object ? [row.object.subscriberId] : [])))];
}

async function digitSearch(db: DbOrTx, text: string): Promise<Where> {
  const digits = text.replace(/\D/g, "");
  const reversed = reverseDigits(digits);
  const [phones, equipment] =
    digits.length >= MIN_PHONE_SEARCH
      ? await Promise.all([
          matchingContacts(db, {
            OR: [{ phoneRev: { startsWith: reversed } }, { phone2Rev: { startsWith: reversed } }],
          }),
          matchingEquipment(db, digits),
        ])
      : [[], []];
  const owners = [...phones, ...equipment];
  const matches: Where[] = [
    { legacyCode: text },
    { taxId: { startsWith: digits } },
    ...(CODE_DIGITS.test(digits) ? [{ code: BigInt(digits) }] : []),
    ...(owners.length > 0 ? [{ id: { in: owners } }] : []),
  ];
  return { OR: matches };
}

async function searchWhere(db: DbOrTx, text: string): Promise<Where> {
  if (text.includes("@")) return { id: { in: await matchingContacts(db, { email: text.toLowerCase() }) } };
  if (PHONE_LIKE.test(text)) return digitSearch(db, text);
  const name = normalizeName(text);
  const byName: Where[] = name.length >= MIN_NAME_SEARCH ? [{ nameNorm: { contains: escapeLike(name) } }] : [];
  return { OR: [{ legacyCode: text }, ...byName] };
}

async function filtersWhere(db: DbOrTx, query: SubscriberCountQuery, scope: RecordScope): Promise<Where> {
  const { q, status, type, programId, tariffId, managerId, archived } = query;
  return {
    // In an AND of its own: the filter by manager below would replace it as a key of this object
    AND: [subscriberWhere(scope)],
    archivedAt: archived ? { not: null } : null,
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
    ...(programId ? { programId } : {}),
    ...(tariffId ? { tariffId } : {}),
    ...(managerId ? { managerId } : {}),
    ...(q ? await searchWhere(db, q) : {}),
  };
}

interface SortColumn {
  column: "nameNorm" | "code" | "objectsActive" | "id";
  parse: (value: string) => string | number | bigint;
  read: (row: SubscriberPageRow) => string;
}

// uuidv7 orders by creation, so a sort by the date of registration needs no column of its own
const SORTS: Record<SubscriberSort, SortColumn> = {
  name: { column: "nameNorm", parse: (value) => value, read: (row) => row.nameNorm },
  code: { column: "code", parse: BigInt, read: (row) => String(row.code) },
  objects: { column: "objectsActive", parse: Number, read: (row) => String(row.objectsActive) },
  createdAt: { column: "id", parse: (value) => value, read: (row) => row.id },
};

// The first condition is implied by the second, and it is what lets the index start at the cursor instead of the top
function keysetWhere(query: SubscriberListQuery): Where {
  if (!query.cursor) return {};
  const { value, id } = decodeListCursor(query.cursor);
  const { column, parse } = SORTS[query.sort];
  const past = query.order === "asc" ? "gt" : "lt";
  if (column === "id") return { id: { [past]: id } };
  const from = query.order === "asc" ? "gte" : "lte";
  const parsed = parse(value);
  return {
    AND: [
      { [column]: { [from]: parsed } },
      { OR: [{ [column]: { [past]: parsed } }, { [column]: parsed, id: { [past]: id } }] },
    ],
  };
}

const PAGE_ROW = {
  id: true,
  code: true,
  legacyCode: true,
  name: true,
  nameNorm: true,
  taxId: true,
  type: true,
  status: true,
  objectsActive: true,
  objectsSuspended: true,
  objectsDisconnected: true,
  archivedAt: true,
  program: { select: { name: true } },
  tariff: { select: { name: true } },
  manager: { select: { fullName: true } },
} satisfies Prisma.SubscriberSelect;

type SubscriberPageRow = Prisma.SubscriberGetPayload<{ select: typeof PAGE_ROW }>;

function toListItem(row: SubscriberPageRow): SubscriberListItem {
  return {
    id: row.id,
    code: Number(row.code),
    legacyCode: row.legacyCode,
    name: row.name,
    taxId: row.taxId,
    type: row.type,
    status: row.status,
    programName: row.program.name,
    tariffName: row.tariff.name,
    objectsActive: row.objectsActive,
    objectsTotal: row.objectsActive + row.objectsSuspended + row.objectsDisconnected,
    managerName: row.manager.fullName,
    isArchived: row.archivedAt !== null,
  };
}

export async function listSubscribers(
  db: DbOrTx,
  query: SubscriberListQuery,
  scope: RecordScope,
): Promise<SubscriberList> {
  const { column, read } = SORTS[query.sort];
  const rows = await db.subscriber.findMany({
    where: { AND: [await filtersWhere(db, query, scope), keysetWhere(query)] },
    orderBy: column === "id" ? { id: query.order } : [{ [column]: query.order }, { id: query.order }],
    take: query.limit + 1,
    select: PAGE_ROW,
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toListItem),
    nextCursor: rows.length > query.limit && last ? encodeListCursor({ value: read(last), id: last.id }) : null,
  };
}

// Past the cap nobody reads the exact number, and counting it would cost the whole table
export async function countSubscribers(
  db: DbOrTx,
  query: SubscriberCountQuery,
  scope: RecordScope,
): Promise<SubscriberCount> {
  const count = await db.subscriber.count({ where: await filtersWhere(db, query, scope), take: COUNT_CAP + 1 });
  return { count: Math.min(count, COUNT_CAP), isCapped: count > COUNT_CAP };
}

async function readTariffHistory(db: DbOrTx, subscriberId: string): Promise<TariffVersion[]> {
  const rows = await db.subscriberTariffPeriod.findMany({
    where: { subscriberId },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    take: HISTORY_MAX,
    select: {
      id: true,
      tariffId: true,
      validFrom: true,
      validTo: true,
      tariff: {
        select: {
          name: true,
          billingModel: true,
          priceKop: true,
          program: { select: { name: true } },
          server: { select: { name: true } },
        },
      },
    },
  });
  return rows
    .map(({ tariff, validFrom, validTo, ...row }) => ({
      ...row,
      tariffName: tariff.name,
      programName: tariff.program.name,
      serverName: tariff.server.name,
      billingModel: tariff.billingModel,
      priceKop: Number(tariff.priceKop),
      validFrom: fromDbDate(validFrom),
      validTo: validTo && fromDbDate(validTo),
    }))
    .filter((period) => period.validTo === null || period.validTo > period.validFrom);
}

async function readContractFacts(db: DbOrTx, subscriberId: string) {
  const [{ _max: latest }, contractCount] = await Promise.all([
    db.contract.aggregate({ where: { subscriberId, archivedAt: null }, _max: { validUntil: true } }),
    db.contract.count({ where: { subscriberId } }),
  ]);
  return { contractValidUntil: latest.validUntil && fromDbDate(latest.validUntil), contractCount };
}

export async function getSubscriberCard(db: DbOrTx, id: string, scope: RecordScope): Promise<SubscriberCard | null> {
  const row = await db.subscriber.findFirst({
    where: { id, ...subscriberWhere(scope) },
    select: {
      id: true,
      version: true,
      code: true,
      legacyCode: true,
      type: true,
      name: true,
      taxId: true,
      crmUrl: true,
      managerId: true,
      status: true,
      programId: true,
      tariffId: true,
      graceDays: true,
      discountKop: true,
      note: true,
      objectsActive: true,
      objectsSuspended: true,
      objectsDisconnected: true,
      createdAt: true,
      updatedAt: true,
      archivedAt: true,
      manager: { select: { fullName: true } },
      program: { select: { name: true } },
    },
  });
  if (!row) return null;
  const { code, discountKop, manager, program, createdAt, updatedAt, archivedAt, ...fields } = row;
  const [tariffHistory, contracts] = await Promise.all([readTariffHistory(db, id), readContractFacts(db, id)]);
  return {
    ...fields,
    ...contracts,
    code: Number(code),
    discountKop: Number(discountKop),
    managerName: manager.fullName,
    programName: program.name,
    tariffHistory,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    isArchived: archivedAt !== null,
  };
}

export async function checkSubscriberCode(
  db: DbOrTx,
  code: string,
  excludeId: string | undefined,
  scope: RecordScope,
): Promise<SubscriberCodeCheck> {
  if (!CODE_DIGITS.test(code)) return { isValid: false, isFree: false, holder: null };
  const holder = await db.subscriber.findUnique({
    where: { code: BigInt(code) },
    select: { id: true, name: true, managerId: true },
  });
  if (!holder || holder.id === excludeId) return { isValid: true, isFree: true, holder: null };
  const isVisible = !scope.managerId || holder.managerId === scope.managerId;
  return { isValid: true, isFree: false, holder: isVisible ? { id: holder.id, name: holder.name } : null };
}

async function readDuplicates(
  db: DbOrTx,
  field: DuplicateField,
  where: Where,
  query: DuplicatesQuery,
  scope: RecordScope,
): Promise<DuplicateList["items"]> {
  const rows = await db.subscriber.findMany({
    where: { AND: [where, subscriberWhere(scope), query.excludeId ? { NOT: { id: query.excludeId } } : {}] },
    orderBy: { id: "desc" },
    take: DUPLICATES_MAX,
    select: { id: true, code: true, name: true },
  });
  return rows.map((row) => ({ field, id: row.id, code: Number(row.code), name: row.name }));
}

// A form asks this as a person types, so a half-typed value simply finds nothing
export async function findDuplicates(db: DbOrTx, query: DuplicatesQuery, scope: RecordScope): Promise<DuplicateList> {
  const phone = query.phone ? normalizePhone(query.phone) : null;
  const phoneOwners = phone
    ? await matchingContacts(db, {
        OR: [{ phoneRev: reverseDigits(phone) }, { phone2Rev: reverseDigits(phone) }],
      })
    : [];
  const lookups: [DuplicateField, Where | null][] = [
    ["taxId", query.taxId ? { taxId: query.taxId } : null],
    ["phone", phoneOwners.length > 0 ? { id: { in: phoneOwners } } : null],
    ["crmUrl", query.crmUrl ? { crmUrl: query.crmUrl } : null],
    ["legacyCode", query.legacyCode ? { legacyCode: query.legacyCode } : null],
  ];
  const found = await Promise.all(
    lookups.flatMap(([field, where]) => (where ? [readDuplicates(db, field, where, query, scope)] : [])),
  );
  return { items: found.flat() };
}

export type ArchivableKind = "subscriber" | "contact" | "payer" | "contract";

const NO_RECORD = undefined;
type RecordBatch = { archiveBatchId: string | null } | null;

function readRecordBatch(db: DbOrTx, kind: ArchivableKind, id: string, scope: RecordScope): Promise<RecordBatch> {
  const select = { archiveBatchId: true };
  if (kind === "subscriber") return db.subscriber.findFirst({ where: { id, ...subscriberWhere(scope) }, select });
  if (kind === "contact") return db.contact.findFirst({ where: { id, ...scopedContact(scope) }, select });
  if (kind === "payer") return db.payer.findFirst({ where: { id, ...scopedPayer(scope) }, select });
  return db.contract.findFirst({ where: { id, ...scopedContract(scope) }, select });
}

// undefined: no such record for this person. null: it is there and not in the archive.
export async function findRecordBatch(
  db: DbOrTx,
  kind: ArchivableKind,
  id: string,
  scope: RecordScope,
): Promise<string | null | undefined> {
  const row = await readRecordBatch(db, kind, id, scope);
  return row ? row.archiveBatchId : NO_RECORD;
}

export async function listManagers(db: DbOrTx): Promise<ManagerList> {
  const rows = await db.user.findMany({
    where: { status: "active" },
    orderBy: { fullName: "asc" },
    take: MANAGERS_MAX,
    select: { id: true, fullName: true },
  });
  return { items: rows };
}

const NO_OBJECTS: ObjectCounts = { objectsActive: 0, objectsSuspended: 0, objectsDisconnected: 0 };
const COUNT_OF_STATUS = {
  active: "objectsActive",
  suspended: "objectsSuspended",
  disconnected: "objectsDisconnected",
} as const;

// П18: what the objects themselves say. An object in the archive counts for nobody.
export async function readObjectFacts(db: DbOrTx, subscriberIds: string[]): Promise<Map<string, ObjectCounts>> {
  const rows = await db.monitoredObject.groupBy({
    by: ["subscriberId", "status"],
    where: { subscriberId: { in: subscriberIds }, archivedAt: null },
    _count: { _all: true },
  });
  const facts = new Map(subscriberIds.map((id) => [id, { ...NO_OBJECTS }]));
  for (const { subscriberId, status, _count } of rows) {
    const counts = facts.get(subscriberId);
    if (counts) counts[COUNT_OF_STATUS[status]] = _count._all;
  }
  return facts;
}

// All of them, in the archive too: a client with any object has a history that a delete would hide (П21)
export function countAllObjects(db: DbOrTx, subscriberId: string): Promise<number> {
  return db.monitoredObject.count({ where: { subscriberId } });
}

export async function findManagerName(db: DbOrTx, id: string): Promise<string | null> {
  const user = await db.user.findFirst({ where: { id, status: "active" }, select: { fullName: true } });
  return user?.fullName ?? null;
}
