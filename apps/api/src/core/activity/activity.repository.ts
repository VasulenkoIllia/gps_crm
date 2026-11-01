import type { Prisma } from "../../generated/prisma/client.js";
import type { DbOrTx } from "../db/client.js";

export type ActivityAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "auth.logout_everywhere"
  | "auth.session_ended"
  | "auth.password_changed"
  | "auth.password_reset"
  | "auth.password_reset_requested"
  | "auth.password_reset_link_created"
  | "two_factor.enabled"
  | "two_factor.reset"
  | "two_factor.recovery_code_used"
  | "two_factor.recovery_codes_regenerated"
  | "user.first_admin_created"
  | "user.invited"
  | "user.invitation_accepted"
  | "user.profile_updated"
  | "user.blocked"
  | "user.unblocked";

export type Actor = { kind: "user"; id: string } | { kind: "system" };

export const SYSTEM_ACTOR: Actor = { kind: "system" };

// Who did it and from where. A service does not know HTTP, so the route builds this and hands it down.
export interface ActivityContext {
  actor: Actor;
  ip: string | null;
  requestId: string | null;
}

export interface ActivityEventInput {
  action: ActivityAction;
  entityType?: string;
  entityId?: string;
  // { field: [before, after] }, changed fields only; a secret gets the fact of the change and never a value (П3)
  changes?: Record<string, [unknown, unknown]>;
  details?: Record<string, string | number | boolean | null>;
  retentionClass?: "standard" | "security";
}

// The one way into the journal (activity.md П1): pass the service's transaction, so a failed record undoes the change.
// The runtime role may only insert here, a change of a row is refused by the database.
export async function recordActivity(db: DbOrTx, context: ActivityContext, event: ActivityEventInput): Promise<void> {
  await db.activityEvent.create({
    data: {
      actorKind: context.actor.kind,
      actorId: context.actor.kind === "user" ? context.actor.id : null,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      changes: toJson(event),
      ip: context.ip,
      requestId: context.requestId,
      retentionClass: event.retentionClass ?? "standard",
    },
  });
}

function toJson(event: ActivityEventInput): Prisma.InputJsonValue | undefined {
  if (event.changes) return event.changes as Prisma.InputJsonValue;
  return event.details;
}
