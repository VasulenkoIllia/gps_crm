import {
  ACTIVITY_ENTITY_LABEL_FIELD,
  decodeActivityCursor,
  encodeActivityCursor,
  type ActivityActorList,
  type ActivityEvent,
  type ActivityList,
  type ActivityListQuery,
  type ArchiveList,
  type ArchiveListQuery,
} from "@gps_crm/shared";
import { Prisma } from "../../generated/prisma/client.js";
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

function conditionsOf(query: ActivityListQuery): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
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

// Newest first on the primary key, walked backwards. A count is left out on purpose: a long period would have to read
// every partition in it (activity.md §11).
export async function listActivity(db: DbOrTx, query: ActivityListQuery): Promise<ActivityList> {
  const conditions = conditionsOf(query);
  const where = conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
  const rows = await db.$queryRaw<EventRow[]>`
    SELECT
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
    FROM activity_events e
    LEFT JOIN users actor ON actor.id = e.actor_id
    LEFT JOIN users target ON e.entity_type = 'user' AND target.id = e.entity_id
    ${where}
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

export async function listActivityActors(db: DbOrTx): Promise<ActivityActorList> {
  const items = await db.user.findMany({
    orderBy: { fullName: "asc" },
    take: ACTORS_MAX,
    select: { id: true, fullName: true },
  });
  return { items };
}

// Keyset on id: uuidv7 orders by creation
export async function listArchive(db: DbOrTx, query: ArchiveListQuery): Promise<ArchiveList> {
  const rows = await db.archiveBatch.findMany({
    orderBy: { id: "desc" },
    take: query.limit + 1,
    where: { restoredAt: null, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
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
