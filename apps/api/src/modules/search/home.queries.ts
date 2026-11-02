import { HOME_RECENT_RECORDS, type RecentRecord } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { objectWhere } from "../objects/index.js";
import { subscriberWhere } from "../subscribers/index.js";

// Enough lines of the journal to find eight records in, when one record had many changes in a row
const EVENTS_READ = 100;
// The journal is split by month: a bound lets the planner leave the old months alone
const RECENT_DAYS = 90;
const DAY_MS = 86_400_000;

interface Touch {
  kind: RecentRecord["kind"];
  id: string;
  changedAt: Date;
}

// An object is its own record; anything else of a client (a contact, a payer, a contract, a tracker on its object) opens
// the client's card. The newest change of each, in order.
function recordsOf(
  events: { entityType: string | null; entityId: string | null; subscriberId: string | null; occurredAt: Date }[],
) {
  const touches = new Map<string, Touch>();
  for (const event of events) {
    const touch: Touch | null =
      event.entityType === "object" && event.entityId
        ? { kind: "object", id: event.entityId, changedAt: event.occurredAt }
        : event.subscriberId
          ? { kind: "subscriber", id: event.subscriberId, changedAt: event.occurredAt }
          : null;
    const key = touch && `${touch.kind}:${touch.id}`;
    if (touch && key && !touches.has(key)) touches.set(key, touch);
  }
  return [...touches.values()];
}

async function readNames(db: DbOrTx, touches: Touch[], scopes: { clients: RecordScope; objects: RecordScope | null }) {
  const idsOf = (kind: Touch["kind"]) => touches.filter((touch) => touch.kind === kind).map((touch) => touch.id);
  const [clients, objects] = await Promise.all([
    db.subscriber.findMany({
      where: { id: { in: idsOf("subscriber") }, ...subscriberWhere(scopes.clients) },
      select: { id: true, code: true, name: true, archivedAt: true },
    }),
    scopes.objects
      ? db.monitoredObject.findMany({
          where: { id: { in: idsOf("object") }, ...objectWhere(scopes.objects) },
          select: { id: true, name: true, archivedAt: true, subscriber: { select: { code: true } } },
        })
      : [],
  ]);
  const names = new Map<string, Omit<RecentRecord, "kind" | "id" | "changedAt">>();
  for (const row of clients) {
    names.set(`subscriber:${row.id}`, {
      name: row.name,
      subscriberCode: Number(row.code),
      isArchived: row.archivedAt !== null,
    });
  }
  for (const row of objects) {
    const subscriberCode = Number(row.subscriber.code);
    names.set(`object:${row.id}`, { name: row.name, subscriberCode, isArchived: row.archivedAt !== null });
  }
  return names;
}

// search-exports.md B: what this person changed last. A record deleted since, or out of reach now, is left out.
export async function readRecentRecords(
  db: DbOrTx,
  userId: string,
  scopes: { clients: RecordScope; objects: RecordScope | null },
  now: Date,
): Promise<RecentRecord[]> {
  const events = await db.activityEvent.findMany({
    where: {
      actorId: userId,
      occurredAt: { gt: new Date(now.getTime() - RECENT_DAYS * DAY_MS) },
      OR: [{ entityType: "object" }, { subscriberId: { not: null } }],
    },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: EVENTS_READ,
    select: { entityType: true, entityId: true, subscriberId: true, occurredAt: true },
  });
  const touches = recordsOf(events);
  const names = await readNames(db, touches, scopes);
  return touches
    .flatMap((touch) => {
      const named = names.get(`${touch.kind}:${touch.id}`);
      return named ? [{ kind: touch.kind, id: touch.id, ...named, changedAt: touch.changedAt.toISOString() }] : [];
    })
    .slice(0, HOME_RECENT_RECORDS);
}
