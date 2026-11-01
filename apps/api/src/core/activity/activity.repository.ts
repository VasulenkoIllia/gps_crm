import type { ActivityAction } from "@gps_crm/shared";
import type { Prisma } from "../../generated/prisma/client.js";
import type { DbOrTx } from "../db/client.js";

export type Actor = { kind: "user"; id: string } | { kind: "system" };

export const SYSTEM_ACTOR: Actor = { kind: "system" };

// Who did it and from where. A service does not know HTTP, so the route builds this and hands it down.
export interface ActivityContext {
  actor: Actor;
  ip: string | null;
  requestId: string | null;
}

export function actorIdOf(context: ActivityContext): string | null {
  return context.actor.kind === "user" ? context.actor.id : null;
}

export interface ActivityEventInput {
  action: ActivityAction;
  entityType?: string;
  entityId?: string;
  // The client the record belongs to: what the journal of a card and the level `own` of access go by
  subscriberId?: string;
  // The whole record, for what is gone after this line (03-data-model.md §3.5)
  snapshot?: Prisma.InputJsonValue;
  // { field: [before, after] }, changed fields only; a secret gets the fact of the change and never a value (П3)
  changes?: Record<string, [unknown, unknown]>;
  details?: Record<string, string | number | boolean | null>;
  retentionClass?: "standard" | "security";
}

// The one way into the journal (activity.md П1): pass the service's transaction, so a failed record undoes the change.
// The runtime role may only insert here, a change of a row is refused by the database.
export async function recordActivity(db: DbOrTx, context: ActivityContext, event: ActivityEventInput): Promise<void> {
  await db.activityEvent.create({ data: toRow(context, event) });
}

// A package in one statement, so a mass action costs the transaction the same at 5 records and at 5 000 (activity.md §11)
export async function recordActivities(
  db: DbOrTx,
  context: ActivityContext,
  events: ActivityEventInput[],
): Promise<void> {
  await db.activityEvent.createMany({ data: events.map((event) => toRow(context, event)) });
}

// The month in hand and this many ahead (activity.md П6). The owner's function does the work: the runtime role has no DDL.
export const ACTIVITY_MONTHS_AHEAD = 3;

export interface PartitionResult {
  created: number;
  // Rows the default partition holds: none is the normal state, and each makes the next ATTACH scan it (03-data-model.md)
  stranded: number;
}

export async function ensureActivityPartitions(
  db: DbOrTx,
  monthsAhead = ACTIVITY_MONTHS_AHEAD,
): Promise<PartitionResult> {
  const rows = await db.$queryRaw<{ created: number; stranded: bigint }[]>`
    SELECT created, stranded FROM ensure_activity_partitions(${monthsAhead}::integer)
  `;
  return { created: rows[0]?.created ?? 0, stranded: Number(rows[0]?.stranded ?? 0) };
}

function toRow(context: ActivityContext, event: ActivityEventInput) {
  return {
    actorKind: context.actor.kind,
    actorId: actorIdOf(context),
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    subscriberId: event.subscriberId,
    snapshot: event.snapshot,
    changes: toJson(event),
    ip: context.ip,
    requestId: context.requestId,
    retentionClass: event.retentionClass ?? "standard",
  };
}

function toJson(event: ActivityEventInput): Prisma.InputJsonValue | undefined {
  if (!event.changes && !event.details) return undefined;
  return { ...event.details, ...event.changes } as Prisma.InputJsonValue;
}
