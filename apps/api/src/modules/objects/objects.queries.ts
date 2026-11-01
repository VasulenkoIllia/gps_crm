import {
  decodeListCursor,
  encodeListCursor,
  normalizeName,
  reverseDigits,
  type ObjectCount,
  type ObjectCountQuery,
  type ObjectList,
  type ObjectListItem,
  type ObjectListQuery,
  type ObjectSort,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";
import { escapeLike } from "../../core/db/like.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { objectWhere } from "./objects.repository.js";

const COUNT_CAP = 10_000;
export const HISTORY_MAX = 100;
const MIN_NAME_SEARCH = 3;
const MIN_NUMBER_SEARCH = 4;
const MATCHES_MAX = 200;
const PHONE_LIKE = /^[\d\s()+-]+$/;
const CODE_DIGITS = /^\d{5,15}$/;

type Where = Prisma.MonitoredObjectWhereInput;

export interface TariffFact {
  tariffId: string;
  tariffName: string;
  programId: string;
  programName: string;
  serverId: string;
  serverName: string;
}

const TARIFF_FACT = {
  id: true,
  name: true,
  programId: true,
  serverId: true,
  program: { select: { name: true } },
  server: { select: { name: true } },
} satisfies Prisma.TariffSelect;

type TariffRow = Prisma.TariffGetPayload<{ select: typeof TARIFF_FACT }>;

function toTariffFact({ id, name, programId, serverId, program, server }: TariffRow): TariffFact {
  return {
    tariffId: id,
    tariffName: name,
    programId,
    programName: program.name,
    serverId,
    serverName: server.name,
  };
}

export async function findTariffFact(db: DbOrTx, id: string): Promise<TariffFact> {
  const row = await db.tariff.findUniqueOrThrow({ where: { id }, select: TARIFF_FACT });
  return toTariffFact(row);
}

export async function findClientTariffId(db: DbOrTx, subscriberId: string): Promise<string> {
  const row = await db.subscriber.findUniqueOrThrow({ where: { id: subscriberId }, select: { tariffId: true } });
  return row.tariffId;
}

export async function findPayerName(db: DbOrTx, id: string): Promise<string> {
  const row = await db.payer.findUniqueOrThrow({ where: { id }, select: { name: true } });
  return row.name;
}

export async function findAddonName(db: DbOrTx, id: string): Promise<string> {
  const row = await db.addon.findUniqueOrThrow({ where: { id }, select: { name: true } });
  return row.name;
}

export async function isAddonOfProgram(db: DbOrTx, addonId: string, programId: string): Promise<boolean> {
  const link = await db.addonProgram.findFirst({ where: { addonId, programId }, select: { addonId: true } });
  return link !== null;
}

// Two steps, by the index of each number: an OR over joined tables reads all of them (subscribers.queries.ts)
async function devicesByNumber(db: DbOrTx, digits: string): Promise<string[]> {
  const reversed = reverseDigits(digits);
  const [devices, sims] = await Promise.all([
    db.device.findMany({
      where: { archivedAt: null, OR: [{ imei: { startsWith: digits } }, { imeiRev: { startsWith: reversed } }] },
      take: MATCHES_MAX,
      select: { id: true },
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
      take: MATCHES_MAX,
      select: { device: { select: { id: true } } },
    }),
  ]);
  return [...devices, ...sims.flatMap((sim) => (sim.device ? [sim.device] : []))].map((row) => row.id);
}

async function clientsByText(db: DbOrTx, text: string): Promise<string[]> {
  const digits = text.replace(/\D/g, "");
  const name = normalizeName(text);
  const matches: Prisma.SubscriberWhereInput[] = [
    { legacyCode: text },
    ...(name.length >= MIN_NAME_SEARCH ? [{ nameNorm: { contains: escapeLike(name) } }] : []),
    ...(CODE_DIGITS.test(digits) ? [{ code: BigInt(digits) }] : []),
  ];
  const rows = await db.subscriber.findMany({ where: { OR: matches }, take: MATCHES_MAX, select: { id: true } });
  return rows.map((row) => row.id);
}

async function searchWhere(db: DbOrTx, text: string): Promise<Where> {
  const name = normalizeName(text);
  const digits = text.replace(/\D/g, "");
  const isNumber = PHONE_LIKE.test(text) && digits.length >= MIN_NUMBER_SEARCH;
  const [deviceIds, clientIds] = await Promise.all([
    isNumber ? devicesByNumber(db, digits) : [],
    clientsByText(db, text),
  ]);
  return {
    OR: [
      ...(name.length >= MIN_NAME_SEARCH ? [{ nameNorm: { contains: escapeLike(name) } }] : []),
      ...(deviceIds.length > 0 ? [{ currentDeviceId: { in: deviceIds } }] : []),
      ...(clientIds.length > 0 ? [{ subscriberId: { in: clientIds } }] : []),
    ],
  };
}

async function filtersWhere(db: DbOrTx, query: ObjectCountQuery, scope: RecordScope): Promise<Where> {
  const { q, status, programId, serverId, tariffId, modelId, addonId, subscriberId, managerId, archived } = query;
  return {
    // In an AND of its own: the filter by manager below would replace it as a key of this object
    AND: [objectWhere(scope), ...(managerId ? [{ subscriber: { managerId } }] : [])],
    archivedAt: archived ? { not: null } : null,
    ...(status ? { status } : {}),
    ...(programId ? { programId } : {}),
    ...(serverId ? { serverId } : {}),
    ...(tariffId ? { tariffId } : {}),
    ...(subscriberId ? { subscriberId } : {}),
    ...(modelId ? { currentDevice: { modelId } } : {}),
    ...(addonId ? { addonPeriods: { some: { addonId, validTo: null } } } : {}),
    ...(q ? await searchWhere(db, q) : {}),
  };
}

const PAGE_ROW = {
  id: true,
  name: true,
  nameNorm: true,
  subscriberId: true,
  hasOwnTariff: true,
  status: true,
  statusFrom: true,
  connectedOn: true,
  createdAt: true,
  archivedAt: true,
  subscriber: { select: { code: true, name: true } },
  program: { select: { name: true } },
  tariff: { select: { name: true } },
  currentDevice: { select: { imei: true, model: { select: { name: true } } } },
  addonPeriods: { where: { validTo: null }, select: { addon: { select: { name: true } } } },
} satisfies Prisma.MonitoredObjectSelect;

type PageRow = Prisma.MonitoredObjectGetPayload<{ select: typeof PAGE_ROW }>;

function toListItem(row: PageRow): ObjectListItem {
  const { subscriber, program, tariff, currentDevice, addonPeriods, statusFrom, connectedOn, createdAt } = row;
  return {
    id: row.id,
    name: row.name,
    subscriberId: row.subscriberId,
    subscriberCode: Number(subscriber.code),
    subscriberName: subscriber.name,
    programName: program.name,
    tariffName: tariff.name,
    hasOwnTariff: row.hasOwnTariff,
    addonNames: addonPeriods.map((period) => period.addon.name),
    modelName: currentDevice?.model?.name ?? null,
    imei: currentDevice?.imei ?? null,
    status: row.status,
    statusFrom: fromDbDate(statusFrom),
    connectedOn: fromDbDate(connectedOn),
    createdAt: createdAt.toISOString(),
    isArchived: row.archivedAt !== null,
  };
}

interface SortColumn {
  column: "nameNorm" | "connectedOn" | "subscriberId" | "id";
  parse: (value: string) => string | Date;
  read: (row: PageRow) => string;
}

// uuidv7 orders by creation. A sort by client groups the rows of each: by name it would need the name on every object
const SORTS: Record<ObjectSort, SortColumn> = {
  name: { column: "nameNorm", parse: (value) => value, read: (row) => row.nameNorm },
  connectedOn: { column: "connectedOn", parse: toDbDate, read: (row) => fromDbDate(row.connectedOn) },
  createdAt: { column: "id", parse: (value) => value, read: (row) => row.id },
  subscriber: { column: "subscriberId", parse: (value) => value, read: (row) => row.subscriberId },
};

// The first condition is implied by the second, and it is what lets the index start at the cursor instead of the top
function keysetWhere(query: ObjectListQuery): Where {
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

export async function listObjects(db: DbOrTx, query: ObjectListQuery, scope: RecordScope): Promise<ObjectList> {
  const { column, read } = SORTS[query.sort];
  const rows = await db.monitoredObject.findMany({
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
export async function countObjects(db: DbOrTx, query: ObjectCountQuery, scope: RecordScope): Promise<ObjectCount> {
  const count = await db.monitoredObject.count({ where: await filtersWhere(db, query, scope), take: COUNT_CAP + 1 });
  return { count: Math.min(count, COUNT_CAP), isCapped: count > COUNT_CAP };
}

export async function findVisibleObjectId(db: DbOrTx, id: string, scope: RecordScope): Promise<string | null> {
  const row = await db.monitoredObject.findFirst({ where: { id, ...objectWhere(scope) }, select: { id: true } });
  return row?.id ?? null;
}

export interface ArchiveState {
  batchId: string | null;
  clientName: string | null;
}

// What a restore needs to know before it takes any lock
export async function readArchiveState(db: DbOrTx, id: string, scope: RecordScope): Promise<ArchiveState | null> {
  const row = await db.monitoredObject.findFirst({
    where: { id, ...objectWhere(scope) },
    select: { archiveBatchId: true, subscriber: { select: { name: true, archivedAt: true } } },
  });
  if (!row) return null;
  return {
    batchId: row.archiveBatchId,
    clientName: row.subscriber.archivedAt ? row.subscriber.name : null,
  };
}
