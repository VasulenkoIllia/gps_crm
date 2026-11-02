import {
  isNumberQuery,
  SEARCH_GROUP_SIZE,
  type ClientHit,
  type DeviceHit,
  type DeviceRow,
  type ObjectHit,
  type ObjectListItem,
  type SearchGroup,
  type SearchQuery,
  type SearchResult,
  type SimHit,
  type SimRow,
  type SubscriberListItem,
} from "@gps_crm/shared";
import type { Logger } from "pino";
import type { RecordScope } from "../../core/access/access.js";
import { isTimedOut, type DbClient, type DbOrTx } from "../../core/db/client.js";
import { AppError } from "../../core/errors.js";
import { listDevices, listSims } from "../equipment/index.js";
import { listObjects } from "../objects/index.js";
import { listSubscribers } from "../subscribers/index.js";
import { limitStatementTime, searchContacts } from "./search.queries.js";

// П3
const TIME_LIMIT_MS = 2_000;

// What the person may see of each kind: a group without its permission is not read at all
export interface SearchScopes {
  clients: RecordScope;
  objects: RecordScope | null;
  hasEquipment: boolean;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

type Archived = "true" | undefined;

// The groups are the lists themselves: «Показати всі» then shows the same rows and more. The lists hold either the live
// records or the archive, so П4 reads the archive second, after the live ones.
async function groupOf<T, H>(
  read: (archived: Archived) => Promise<Page<T>>,
  toHit: (row: T) => H,
  withArchive: boolean,
): Promise<SearchGroup<H>> {
  const live = await read(undefined);
  if (!withArchive || live.nextCursor) return { items: live.items.map(toHit), hasMore: live.nextCursor !== null };
  const archived = await read("true");
  const rows = [...live.items, ...archived.items];
  return {
    items: rows.slice(0, SEARCH_GROUP_SIZE).map(toHit),
    hasMore: rows.length > SEARCH_GROUP_SIZE || archived.nextCursor !== null,
  };
}

function clientHit(row: SubscriberListItem): ClientHit {
  const { id, code, legacyCode, name, taxId, isArchived } = row;
  return { id, code, legacyCode, name, taxId, isArchived };
}

function objectHit(row: ObjectListItem): ObjectHit {
  const { id, name, imei, subscriberCode, subscriberName, isArchived } = row;
  return { id, name, imei, subscriberCode, subscriberName, isArchived };
}

function deviceHit(row: DeviceRow): DeviceHit {
  const { id, imei, modelName, place, isArchived } = row;
  return { id, imei, modelName, objectId: place?.objectId ?? null, objectName: place?.objectName ?? null, isArchived };
}

function simHit(row: SimRow): SimHit {
  const { id, iccid, msisdn, deviceImei, place, isArchived } = row;
  return {
    id,
    iccid,
    msisdn,
    deviceImei,
    objectId: place?.objectId ?? null,
    objectName: place?.objectName ?? null,
    isArchived,
  };
}

const page = { limit: SEARCH_GROUP_SIZE };
const byName = { ...page, sort: "name", order: "asc" } as const;

async function readGroups(db: DbOrTx, query: SearchQuery, scopes: SearchScopes): Promise<SearchResult> {
  const { q } = query;
  const withArchive = query.archived === "true";
  // П2: a text never reaches the numbers of the equipment, though a list would take its digits
  const isNumber = isNumberQuery(q);
  const { clients, objects, hasEquipment } = scopes;
  const canSeeEquipment = hasEquipment && isNumber;
  return {
    clients: await groupOf(
      (archived) => listSubscribers(db, { q, archived, ...byName }, clients),
      clientHit,
      withArchive,
    ),
    contacts: await searchContacts(db, q, isNumber, clients, withArchive),
    objects: objects
      ? await groupOf((archived) => listObjects(db, { q, archived, ...byName }, objects), objectHit, withArchive)
      : null,
    devices: canSeeEquipment
      ? await groupOf((archived) => listDevices(db, { q, archived, ...page }), deviceHit, withArchive)
      : null,
    sims: canSeeEquipment
      ? await groupOf((archived) => listSims(db, { q, archived, ...page }), simHit, withArchive)
      : null,
  };
}

// П3: every statement and the whole read within 2 seconds, so a search that went wide frees its connection. A pool
// with no free connection for 2 seconds ends the same way; the log keeps which of the two it was.
export async function search(
  { db, logger }: { db: DbClient; logger: Pick<Logger, "warn"> },
  query: SearchQuery,
  scopes: SearchScopes,
): Promise<SearchResult> {
  try {
    return await db.$transaction(
      async (tx) => {
        await limitStatementTime(tx, TIME_LIMIT_MS);
        return readGroups(tx, query, scopes);
      },
      { timeout: TIME_LIMIT_MS },
    );
  } catch (error) {
    if (!isTimedOut(error)) throw error;
    logger.warn({ err: error }, "search timed out");
    throw new AppError(503, "search_timeout", "Пошук триває надто довго. Уточніть запит.");
  }
}
