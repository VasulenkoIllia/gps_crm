import {
  ACTIVITY_ENTITY_LABEL_FIELD,
  decodeActivityCursor,
  encodeActivityCursor,
  FILE_READ_ACTIONS,
  PACKAGE_ITEM_ACTIONS,
  PACKAGE_ITEMS_MAX,
  type ActivityActorList,
  type ActivityEvent,
  type ActivityList,
  type ActivityListQuery,
  type ArchiveList,
  type ArchiveListQuery,
  type PackageAction,
} from "@gps_crm/shared";
import { Prisma } from "../../generated/prisma/client.js";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";

const ACTORS_MAX = 500;

interface EventRow {
  id: string;
  occurredAt: Date;
  // The same moment as text: see the cursor in packages/shared/src/activity.ts
  cursorAt: string;
  actorKind: "user" | "system";
  actorName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  payload: unknown;
  ip: string | null;
  requestId: string | null;
}

export interface ActivityView {
  // D92: a card and the home page, where a look at a file is no news
  hidesFileReads?: boolean;
}

// The level `own`: an event with no client (sign-ins, the reference lists) is nobody's own
function scopeConditions(scope: RecordScope): Prisma.Sql[] {
  if (!scope.managerId) return [];
  return [Prisma.sql`e.subscriber_id IN (SELECT id FROM subscribers WHERE manager_id = ${scope.managerId}::uuid)`];
}

function conditionsOf(query: ActivityListQuery, scope: RecordScope, view: ActivityView): Prisma.Sql[] {
  const conditions = scopeConditions(scope);
  // D92: the line of a package stands for its records, unless the person looks for an action or a record as such
  if (!query.action && !query.entityType && !query.entityId) {
    conditions.push(Prisma.sql`e.action NOT IN (${Prisma.join([...PACKAGE_ITEM_ACTIONS])})`);
  }
  if (view.hidesFileReads) conditions.push(Prisma.sql`e.action NOT IN (${Prisma.join([...FILE_READ_ACTIONS])})`);
  if (query.from) conditions.push(Prisma.sql`e.occurred_at >= ${query.from}::timestamptz`);
  if (query.to) conditions.push(Prisma.sql`e.occurred_at < ${query.to}::timestamptz`);
  if (query.actorId) conditions.push(Prisma.sql`e.actor_id = ${query.actorId}::uuid`);
  if (query.action) conditions.push(Prisma.sql`e.action = ${query.action}`);
  if (query.entityType) conditions.push(Prisma.sql`e.entity_type = ${query.entityType}`);
  if (query.entityId) conditions.push(Prisma.sql`e.entity_id = ${query.entityId}::uuid`);
  if (query.subscriberId) conditions.push(Prisma.sql`e.subscriber_id = ${query.subscriberId}::uuid`);
  if (query.cursor) {
    const { occurredAt, id } = decodeActivityCursor(query.cursor);
    // The first one is implied by the second: a row comparison alone prunes no partition
    conditions.push(Prisma.sql`e.occurred_at <= ${occurredAt}::timestamptz`);
    conditions.push(Prisma.sql`(e.occurred_at, e.id) < (${occurredAt}::timestamptz, ${id}::uuid)`);
  }
  return conditions;
}

// A pair of two is a change, anything else a plain fact: the one column holds both (activity.repository.ts)
function splitPayload(payload: unknown): Pick<ActivityEvent, "changes" | "details"> {
  const changes: ActivityEvent["changes"] = [];
  const details: ActivityEvent["details"] = [];
  if (typeof payload !== "object" || payload === null) return { changes, details };
  for (const [field, value] of Object.entries(payload)) {
    if (field === ACTIVITY_ENTITY_LABEL_FIELD) continue;
    if (Array.isArray(value) && value.length === 2) changes.push({ field, before: value[0], after: value[1] });
    else details.push({ field, value });
  }
  return { changes, details };
}

function toEvent(row: EventRow): ActivityEvent {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorKind: row.actorKind,
    actorName: row.actorName,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    ip: row.ip,
    requestId: row.requestId,
    ...splitPayload(row.payload),
  };
}

const EVENT_COLUMNS = Prisma.sql`
  e.id::text AS id,
  e.occurred_at AS "occurredAt",
  to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",
  e.actor_kind::text AS "actorKind",
  actor.full_name AS "actorName",
  e.action,
  e.entity_type AS "entityType",
  e.entity_id::text AS "entityId",
  COALESCE(target.full_name, e.changes ->> ${ACTIVITY_ENTITY_LABEL_FIELD}) AS "entityLabel",
  e.changes AS payload,
  e.ip,
  e.request_id AS "requestId"
`;

const EVENT_PEOPLE = Prisma.sql`
  LEFT JOIN users actor ON actor.id = e.actor_id
  LEFT JOIN users target ON e.entity_type = 'user' AND target.id = e.entity_id
`;

function whereOf(conditions: Prisma.Sql[]): Prisma.Sql {
  return conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

// Newest first on the primary key, walked backwards. A count is left out on purpose: a long period would have to read
// every partition in it (activity.md §11).
export async function listActivity(
  db: DbOrTx,
  query: ActivityListQuery,
  scope: RecordScope,
  view: ActivityView = {},
): Promise<ActivityList> {
  const rows = await db.$queryRaw<EventRow[]>`
    SELECT ${EVENT_COLUMNS}
    FROM activity_events e
    ${EVENT_PEOPLE}
    ${whereOf(conditionsOf(query, scope, view))}
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT ${query.limit + 1}
  `;
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toEvent),
    nextCursor:
      rows.length > query.limit && last ? encodeActivityCursor({ occurredAt: last.cursorAt, id: last.id }) : null,
  };
}

// D92: the package and its records write their lines in one request and one transaction, which Prisma ends within
// seconds, around the moment the batch keeps. Minutes either side of that moment, passed as values, let both reads prune
// to its partition; the request then tells the lines of this package from the rest of those minutes.
const PACKAGE_WINDOW_MS = 5 * 60_000;

export async function listPackageItems(
  db: DbOrTx,
  batchId: string,
  action: PackageAction,
  scope: RecordScope,
): Promise<ActivityList> {
  const batch = await db.archiveBatch.findUnique({
    where: { id: batchId },
    select: { archivedAt: true, restoredAt: true },
  });
  const moment = action === "record.archived" ? batch?.archivedAt : batch?.restoredAt;
  if (!moment) return { items: [], nextCursor: null };
  const from = new Date(moment.getTime() - PACKAGE_WINDOW_MS).toISOString();
  const to = new Date(moment.getTime() + PACKAGE_WINDOW_MS).toISOString();
  const inWindow = (alias: Prisma.Sql) =>
    Prisma.sql`${alias}.occurred_at > ${from}::timestamptz AND ${alias}.occurred_at < ${to}::timestamptz`;
  const conditions = [
    inWindow(Prisma.raw("e")),
    Prisma.sql`e.request_id = (
      SELECT p.request_id FROM activity_events p
      WHERE ${inWindow(Prisma.raw("p"))} AND p.entity_id = ${batchId}::uuid AND p.action = ${action}
      ORDER BY p.occurred_at DESC, p.id DESC
      LIMIT 1
    )`,
    Prisma.sql`e.action IN (${Prisma.join([...PACKAGE_ITEM_ACTIONS])})`,
    ...scopeConditions(scope),
  ];
  const rows = await db.$queryRaw<EventRow[]>`
    SELECT ${EVENT_COLUMNS}
    FROM activity_events e
    ${EVENT_PEOPLE}
    ${whereOf(conditions)}
    ORDER BY e.occurred_at, e.id
    LIMIT ${PACKAGE_ITEMS_MAX}
  `;
  return { items: rows.map(toEvent), nextCursor: null };
}

export async function listActivityActors(db: DbOrTx): Promise<ActivityActorList> {
  const items = await db.user.findMany({
    orderBy: { fullName: "asc" },
    take: ACTORS_MAX,
    select: { id: true, fullName: true },
  });
  return { items };
}

// Keyset on id: uuidv7 orders by creation
export async function listArchive(db: DbOrTx, query: ArchiveListQuery, scope: RecordScope): Promise<ArchiveList> {
  const rows = await db.archiveBatch.findMany({
    orderBy: { id: "desc" },
    take: query.limit + 1,
    where: {
      restoredAt: null,
      ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      ...(scope.managerId ? { subscriber: { managerId: scope.managerId } } : {}),
    },
  });
  const page = rows.slice(0, query.limit);
  const peopleIds = [...new Set(page.flatMap((row) => row.archivedBy ?? []))];
  const people = await db.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, fullName: true } });
  const names = new Map(people.map((person) => [person.id, person.fullName]));
  return {
    items: page.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      label: row.label,
      itemCount: row.itemCount,
      archivedAt: row.archivedAt.toISOString(),
      archivedByName: (row.archivedBy && names.get(row.archivedBy)) ?? null,
    })),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}
