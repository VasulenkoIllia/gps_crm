import { normalizeName, type PayerCreate, type PayerUpdate } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";

const PAYER_SELECT = {
  id: true,
  version: true,
  name: true,
  paymentMethod: true,
  legalName: true,
  taxId: true,
  vchasnoEmail: true,
  detailsContact: true,
  paymentTermsNote: true,
  note: true,
  archivedAt: true,
} satisfies Prisma.PayerSelect;

export type PayerRow = Prisma.PayerGetPayload<{ select: typeof PAYER_SELECT }>;

// A payer is shared, so its links and contracts reach past the clients this person may see
export function visibleClient(scope: RecordScope): { subscriber?: { managerId: string } } {
  return scope.managerId ? { subscriber: { managerId: scope.managerId } } : {};
}

export function scopedPayer(scope: RecordScope): Prisma.PayerWhereInput {
  return scope.managerId ? { subscribers: { some: { subscriber: { managerId: scope.managerId } } } } : {};
}

// Always by id, and after the clients, as everywhere: two archives of clients with shared payers must not deadlock
export async function lockPayers(tx: DbOrTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT 1 FROM payers WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
}

// A payer belongs to many clients, so the lock of one client does not cover it
export async function lockPayer(tx: DbOrTx, id: string, scope: RecordScope): Promise<PayerRow | null> {
  await tx.$queryRaw`SELECT 1 FROM payers WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  return tx.payer.findFirst({ where: { id, ...scopedPayer(scope) }, select: PAYER_SELECT });
}

export type NewPayer = Omit<PayerCreate, "note"> & { note?: string | null };

export async function createPayer(tx: DbOrTx, input: NewPayer, createdBy: string | null): Promise<string> {
  const { id } = await tx.payer.create({
    data: { ...input, nameNorm: normalizeName(input.name), createdBy, updatedBy: createdBy },
    select: { id: true },
  });
  return id;
}

export async function updatePayer(tx: DbOrTx, id: string, input: PayerUpdate, updatedBy: string | null): Promise<void> {
  await tx.payer.update({
    where: { id },
    data: { ...input, nameNorm: normalizeName(input.name), updatedBy, version: { increment: 1 } },
  });
}

export async function linkPayer(
  tx: DbOrTx,
  payerId: string,
  subscriberId: string,
  createdBy: string | null,
): Promise<boolean> {
  const { count } = await tx.payerSubscriber.createMany({
    data: [{ payerId, subscriberId, createdBy }],
    skipDuplicates: true,
  });
  return count > 0;
}

export async function unlinkPayer(tx: DbOrTx, payerId: string, subscriberId: string): Promise<boolean> {
  const { count } = await tx.payerSubscriber.deleteMany({ where: { payerId, subscriberId } });
  return count > 0;
}

export async function isLinked(tx: DbOrTx, payerId: string, subscriberId: string): Promise<boolean> {
  const link = await tx.payerSubscriber.findUnique({
    where: { payerId_subscriberId: { payerId, subscriberId } },
    select: { payerId: true },
  });
  return link !== null;
}

// The journal of a card goes by one client: a payer of many takes the first it was linked to that this person may see,
// or the line and the archive package would land where the author cannot find them
export async function findFirstClientOf(tx: DbOrTx, payerId: string, scope: RecordScope): Promise<string | undefined> {
  const link = await tx.payerSubscriber.findFirst({
    where: { payerId, ...visibleClient(scope) },
    orderBy: { createdAt: "asc" },
    select: { subscriberId: true },
  });
  return link?.subscriberId;
}

// With the archive: a contract that comes back needs its payer still linked, and the database holds to that
export function countContracts(tx: DbOrTx, payerId: string, subscriberId: string): Promise<number> {
  return tx.contract.count({ where: { payerId, subscriberId } });
}

// subscribers.md П19: who pays for no other live client goes to the archive with this one
export function findPayersOnlyOf(tx: DbOrTx, subscriberId: string): Promise<{ id: string; name: string }[]> {
  return tx.payer.findMany({
    where: {
      archivedAt: null,
      subscribers: { some: { subscriberId } },
      NOT: { subscribers: { some: { subscriberId: { not: subscriberId }, subscriber: { archivedAt: null } } } },
    },
    orderBy: { id: "asc" },
    select: { id: true, name: true },
  });
}

export async function findPayerIdsOf(tx: DbOrTx, subscriberIds: string[]): Promise<string[]> {
  const links = await tx.payerSubscriber.findMany({
    where: { subscriberId: { in: subscriberIds } },
    select: { payerId: true },
  });
  return links.map((link) => link.payerId);
}

export function findPayerInBatches(
  tx: DbOrTx,
  batchIds: string[],
  exceptIds: string[],
): Promise<{ name: string } | null> {
  return tx.payer.findFirst({
    where: { archiveBatchId: { in: batchIds }, id: { notIn: exceptIds } },
    select: { name: true },
  });
}

// For deletion the archive does not count: a payer of an archived client is still that client's payer
export async function findPayerIdsLinkedOnlyTo(tx: DbOrTx, subscriberId: string): Promise<string[]> {
  const rows = await tx.payer.findMany({
    where: {
      subscribers: { some: { subscriberId } },
      NOT: { subscribers: { some: { subscriberId: { not: subscriberId } } } },
    },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function deletePayers(tx: DbOrTx, ids: string[]): Promise<void> {
  await tx.payer.deleteMany({ where: { id: { in: ids } } });
}

export async function archivePayers(
  tx: DbOrTx,
  ids: string[],
  batchId: string,
  archivedBy: string | null,
): Promise<void> {
  await tx.payer.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: new Date(), archivedBy, archiveBatchId: batchId, version: { increment: 1 } },
  });
}

export function findPayersOfBatch(tx: DbOrTx, batchId: string): Promise<{ id: string; name: string }[]> {
  return tx.payer.findMany({ where: { archiveBatchId: batchId }, select: { id: true, name: true } });
}

export async function clearPayerBatch(tx: DbOrTx, batchId: string): Promise<void> {
  await tx.payer.updateMany({
    where: { archiveBatchId: batchId },
    data: { archivedAt: null, archivedBy: null, archiveBatchId: null, version: { increment: 1 } },
  });
}
