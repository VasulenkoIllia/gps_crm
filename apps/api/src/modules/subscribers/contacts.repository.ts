import { normalizeName, reverseDigits, type ContactUpdate, type FirstContact } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";

// More people than a card of a client can reasonably show
const CONTACTS_MAX = 200;

const CONTACT_SELECT = {
  id: true,
  version: true,
  subscriberId: true,
  fullName: true,
  position: true,
  phone: true,
  phone2: true,
  email: true,
  telegramChatId: true,
  viberChatId: true,
  channel: true,
  crmUrl: true,
  isPrimary: true,
  billingNotify: true,
  techNotify: true,
  isActive: true,
  note: true,
  archivedAt: true,
} satisfies Prisma.ContactSelect;

export type ContactRow = Prisma.ContactGetPayload<{ select: typeof CONTACT_SELECT }>;

export function scopedContact(scope: RecordScope): Prisma.ContactWhereInput {
  return scope.managerId ? { subscriber: { managerId: scope.managerId } } : {};
}

export function listContactsOf(db: DbOrTx, subscriberId: string): Promise<ContactRow[]> {
  return db.contact.findMany({
    where: { subscriberId },
    orderBy: [
      { archivedAt: { sort: "asc", nulls: "first" } },
      { isPrimary: "desc" },
      { fullNameNorm: "asc" },
      { id: "asc" },
    ],
    take: CONTACTS_MAX,
    select: CONTACT_SELECT,
  });
}

export function findContact(db: DbOrTx, id: string, scope: RecordScope): Promise<ContactRow | null> {
  return db.contact.findFirst({ where: { id, ...scopedContact(scope) }, select: CONTACT_SELECT });
}

export function findPrimaryContact(tx: DbOrTx, subscriberId: string): Promise<{ id: string; fullName: string } | null> {
  return tx.contact.findFirst({
    where: { subscriberId, isPrimary: true, archivedAt: null },
    select: { id: true, fullName: true },
  });
}

function nameAndPhoneColumns(input: { fullName: string; phone: string; phone2?: string | null }) {
  return {
    fullNameNorm: normalizeName(input.fullName),
    phoneRev: reverseDigits(input.phone),
    phone2Rev: input.phone2 ? reverseDigits(input.phone2) : null,
  };
}

export interface NewContact extends Omit<FirstContact, "channel"> {
  channel: FirstContact["channel"];
  phone2?: string | null;
  crmUrl: string;
  isPrimary: boolean;
  billingNotify: boolean;
  techNotify: boolean;
  isActive: boolean;
  note?: string | null;
}

export async function createContact(
  tx: DbOrTx,
  subscriberId: string,
  input: NewContact,
  createdBy: string | null,
): Promise<string> {
  const { id } = await tx.contact.create({
    data: { ...input, ...nameAndPhoneColumns(input), subscriberId, createdBy, updatedBy: createdBy },
    select: { id: true },
  });
  return id;
}

export async function updateContact(
  tx: DbOrTx,
  id: string,
  input: ContactUpdate,
  updatedBy: string | null,
): Promise<void> {
  await tx.contact.update({
    where: { id },
    data: { ...input, ...nameAndPhoneColumns(input), updatedBy, version: { increment: 1 } },
  });
}

// The old one first: the unique index would refuse two for a moment, and the partial index does not defer
export async function moveIsPrimary(
  tx: DbOrTx,
  subscriberId: string,
  id: string,
  updatedBy: string | null,
): Promise<void> {
  await tx.contact.updateMany({
    where: { subscriberId, isPrimary: true, archivedAt: null, NOT: { id } },
    data: { isPrimary: false, updatedBy, version: { increment: 1 } },
  });
  await tx.contact.update({ where: { id }, data: { isPrimary: true, updatedBy, version: { increment: 1 } } });
}

export async function deleteContact(tx: DbOrTx, id: string): Promise<void> {
  await tx.contact.delete({ where: { id } });
}

export function findActiveContacts(tx: DbOrTx, subscriberId: string): Promise<{ id: string; fullName: string }[]> {
  return tx.contact.findMany({ where: { subscriberId, archivedAt: null }, select: { id: true, fullName: true } });
}

export async function archiveContacts(
  tx: DbOrTx,
  ids: string[],
  batchId: string,
  archivedBy: string | null,
): Promise<void> {
  await tx.contact.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: new Date(), archivedBy, archiveBatchId: batchId, version: { increment: 1 } },
  });
}

export function findContactsOfBatch(tx: DbOrTx, batchId: string) {
  return tx.contact.findMany({
    where: { archiveBatchId: batchId },
    select: {
      id: true,
      fullName: true,
      subscriberId: true,
      subscriber: { select: { name: true, archivedAt: true } },
    },
  });
}

export async function clearContactBatch(tx: DbOrTx, batchId: string): Promise<void> {
  await tx.contact.updateMany({
    where: { archiveBatchId: batchId },
    data: { archivedAt: null, archivedBy: null, archiveBatchId: null, version: { increment: 1 } },
  });
}
