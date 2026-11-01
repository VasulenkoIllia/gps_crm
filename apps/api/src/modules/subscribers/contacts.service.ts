import type { ContactCreate, ContactList, ContactUpdate } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivity,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { assertVersion, changedFields, hasChanges, notFound } from "../references/index.js";
import * as repo from "./contacts.repository.js";
import { recordArchived, requireLiveSubscriber } from "./subscribers.helpers.js";
import { findVisibleId } from "./subscribers.repository.js";

const PRIMARY_NEEDED = "Спершу призначте іншого основного контакту";
const UPDATED_FIELDS = [
  "fullName",
  "position",
  "phone",
  "phone2",
  "email",
  "telegramChatId",
  "viberChatId",
  "channel",
  "crmUrl",
  "billingNotify",
  "techNotify",
  "isActive",
  "note",
] as const;

type ContactDeps = Pick<AppDeps, "db">;

export function primaryNeeded(): AppError {
  return new AppError(409, "primary_contact_required", PRIMARY_NEEDED, { isPrimary: PRIMARY_NEEDED });
}

function contactEvent(
  action: ActivityEventInput["action"],
  contact: { id: string; fullName: string; subscriberId: string },
  extra: Pick<ActivityEventInput, "changes" | "details" | "snapshot"> = {},
): ActivityEventInput {
  return {
    action,
    entityType: "contact",
    entityId: contact.id,
    subscriberId: contact.subscriberId,
    ...extra,
    details: { label: contact.fullName, ...extra.details },
  };
}

export async function listContacts(deps: ContactDeps, scope: RecordScope, subscriberId: string): Promise<ContactList> {
  if (!(await findVisibleId(deps.db, subscriberId, scope))) throw notFound();
  const rows = await repo.listContactsOf(deps.db, subscriberId);
  return {
    items: rows.map(({ archivedAt, ...row }) => ({ ...row, isArchived: archivedAt !== null })),
    nextCursor: null,
  };
}

// The client first and the contact after it: both locks of a contact's write meet at the client (П2)
export async function lockContact(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.ContactRow> {
  const seen = await repo.findContact(tx, id, scope);
  if (!seen) throw notFound();
  await requireLiveSubscriber(tx, seen.subscriberId, scope);
  const contact = await repo.findContact(tx, id, scope);
  if (!contact) throw notFound();
  if (contact.archivedAt) throw recordArchived();
  return contact;
}

export function createContact(
  deps: ContactDeps,
  context: ActivityContext,
  scope: RecordScope,
  subscriberId: string,
  input: ContactCreate,
): Promise<{ id: string }> {
  return deps.db.$transaction(async (tx) => {
    await requireLiveSubscriber(tx, subscriberId, scope);
    const primary = await repo.findPrimaryContact(tx, subscriberId);
    const actorId = actorIdOf(context);
    const id = await repo.createContact(tx, subscriberId, { ...input, isPrimary: !primary }, actorId);
    await recordActivity(tx, context, contactEvent("contact.created", { id, subscriberId, ...input }));
    if (input.isPrimary && primary) await makePrimaryUnderLock(tx, context, { id, subscriberId, ...input });
    return { id };
  });
}

export async function updateContact(
  deps: ContactDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ContactUpdate,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const before = await lockContact(tx, id, scope);
    assertVersion(before, input.version);
    if (before.isPrimary && !input.isPrimary) throw primaryNeeded();
    const changes = changedFields(before, input, [...UPDATED_FIELDS]);
    const actorId = actorIdOf(context);
    if (hasChanges(changes)) {
      await repo.updateContact(tx, id, { ...input, isPrimary: before.isPrimary }, actorId);
      await recordActivity(tx, context, contactEvent("contact.updated", { ...before, ...input }, { changes }));
    }
    if (input.isPrimary && !before.isPrimary) await makePrimaryUnderLock(tx, context, before);
  });
}

async function makePrimaryUnderLock(
  tx: DbOrTx,
  context: ActivityContext,
  contact: { id: string; fullName: string; subscriberId: string },
): Promise<void> {
  const previous = await repo.findPrimaryContact(tx, contact.subscriberId);
  await repo.moveIsPrimary(tx, contact.subscriberId, contact.id, actorIdOf(context));
  await recordActivity(
    tx,
    context,
    contactEvent("contact.primary_changed", contact, { details: { previous: previous?.fullName ?? null } }),
  );
}

export async function makeContactPrimary(
  deps: ContactDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const contact = await lockContact(tx, id, scope);
    if (!contact.isPrimary) await makePrimaryUnderLock(tx, context, contact);
  });
}

export async function deleteContact(
  deps: ContactDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    // An archived one is refused here too: its package would come back with nothing in it
    const contact = await lockContact(tx, id, scope);
    if (contact.isPrimary) throw primaryNeeded();
    await repo.deleteContact(tx, id);
    const snapshot = { ...contact, archivedAt: null };
    await recordActivity(tx, context, contactEvent("contact.deleted", contact, { snapshot }));
  });
}
