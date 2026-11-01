import { deriveSubscriberStatus, normalizeName, type ObjectCounts, type SubscriberUpdate } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";
import type { Prisma, SubscriberType } from "../../generated/prisma/client.js";

const ROW_SELECT = {
  id: true,
  version: true,
  code: true,
  legacyCode: true,
  type: true,
  name: true,
  taxId: true,
  crmUrl: true,
  managerId: true,
  graceDays: true,
  discountKop: true,
  note: true,
  programId: true,
  tariffId: true,
  objectsActive: true,
  objectsSuspended: true,
  objectsDisconnected: true,
  archivedAt: true,
  manager: { select: { fullName: true } },
  tariff: { select: { name: true } },
} satisfies Prisma.SubscriberSelect;

type RawRow = Prisma.SubscriberGetPayload<{ select: typeof ROW_SELECT }>;

export interface SubscriberRow extends Omit<RawRow, "code" | "discountKop" | "manager" | "tariff"> {
  code: number;
  discountKop: number;
  managerName: string;
  tariffName: string;
}

function toRow({ code, discountKop, manager, tariff, ...row }: RawRow): SubscriberRow {
  return {
    ...row,
    code: Number(code),
    discountKop: Number(discountKop),
    managerName: manager.fullName,
    tariffName: tariff.name,
  };
}

export function subscriberWhere(scope: RecordScope): Prisma.SubscriberWhereInput {
  return scope.managerId ? { managerId: scope.managerId } : {};
}

// Every write on a client and on what hangs off it goes under this: a contact, a payer and a contract meet here, so the
// rule of one primary contact or of a free archive cannot be broken from two tabs. The level `own` is part of the search:
// a client of someone else does not exist for this person. NO KEY: the foreign keys of other rows do not wait for it.
export async function lockSubscriber(tx: DbOrTx, id: string, scope: RecordScope): Promise<SubscriberRow | null> {
  await tx.$queryRaw`SELECT 1 FROM subscribers WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  const row = await tx.subscriber.findFirst({ where: { id, ...subscriberWhere(scope) }, select: ROW_SELECT });
  return row ? toRow(row) : null;
}

export async function lockSubscribers(tx: DbOrTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT 1 FROM subscribers WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
}

export async function findVisibleId(db: DbOrTx, id: string, scope: RecordScope): Promise<string | null> {
  const row = await db.subscriber.findFirst({ where: { id, ...subscriberWhere(scope) }, select: { id: true } });
  return row?.id ?? null;
}

export function findCodeHolder(db: DbOrTx, code: number): Promise<{ id: string; name: string } | null> {
  return db.subscriber.findUnique({ where: { code: BigInt(code) }, select: { id: true, name: true } });
}

export function findLegacyHolder(db: DbOrTx, legacyCode: string): Promise<{ id: string; name: string } | null> {
  return db.subscriber.findUnique({ where: { legacyCode }, select: { id: true, name: true } });
}

export interface NewSubscriber {
  type: SubscriberType;
  name: string;
  taxId: string | null;
  crmUrl: string;
  managerId: string;
  graceDays: number;
  discountKop: number;
  legacyCode: string | null;
  note: string | null;
  programId: string;
  tariffId: string;
  createdBy: string | null;
}

// ON CONFLICT DO NOTHING, so a number taken by hand costs a try and not the transaction (03-data-model.md §3.2).
// It also says nothing for a legacy number taken in between: null is either of the two, and the caller tells them apart.
export async function insertSubscriber(tx: DbOrTx, input: NewSubscriber, code: number): Promise<string | null> {
  const { createdBy, ...fields } = input;
  const rows = await tx.subscriber.createManyAndReturn({
    data: [
      {
        ...fields,
        code: BigInt(code),
        nameNorm: normalizeName(input.name),
        discountKop: BigInt(input.discountKop),
        createdBy,
        updatedBy: createdBy,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return rows[0]?.id ?? null;
}

export async function updateSubscriber(
  tx: DbOrTx,
  id: string,
  input: SubscriberUpdate,
  updatedBy: string | null,
): Promise<void> {
  await tx.subscriber.update({
    where: { id },
    data: {
      ...input,
      nameNorm: normalizeName(input.name),
      discountKop: BigInt(input.discountKop),
      updatedBy,
      version: { increment: 1 },
    },
  });
}

export async function updateCode(tx: DbOrTx, id: string, code: number, updatedBy: string | null): Promise<void> {
  await tx.subscriber.update({ where: { id }, data: { code: BigInt(code), updatedBy, version: { increment: 1 } } });
}

export interface TariffPeriod {
  id: string;
  tariffId: string;
  validFrom: string;
  validTo: string | null;
}

export async function findTariffPeriods(tx: DbOrTx, subscriberId: string): Promise<TariffPeriod[]> {
  const rows = await tx.subscriberTariffPeriod.findMany({
    where: { subscriberId },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    select: { id: true, tariffId: true, validFrom: true, validTo: true },
  });
  return rows.map((row) => ({
    ...row,
    validFrom: fromDbDate(row.validFrom),
    validTo: row.validTo && fromDbDate(row.validTo),
  }));
}

export async function closeTariffPeriod(tx: DbOrTx, id: string, validTo: string): Promise<void> {
  await tx.subscriberTariffPeriod.update({ where: { id }, data: { validTo: toDbDate(validTo) } });
}

export async function openTariffPeriod(
  tx: DbOrTx,
  subscriberId: string,
  tariffId: string,
  validFrom: string,
  createdBy: string | null,
): Promise<void> {
  await tx.subscriberTariffPeriod.create({
    data: { subscriberId, tariffId, validFrom: toDbDate(validFrom), createdBy },
  });
}

// The version does not move: an open form of the client's data has nothing against a new tariff, which has its own route
export async function mirrorTariff(
  tx: DbOrTx,
  id: string,
  tariff: { programId: string; tariffId: string },
  updatedBy: string | null,
): Promise<void> {
  await tx.subscriber.update({ where: { id }, data: { ...tariff, updatedBy } });
}

export async function countContracts(tx: DbOrTx, subscriberId: string): Promise<number> {
  return tx.contract.count({ where: { subscriberId } });
}

export async function markSubscriberArchived(
  tx: DbOrTx,
  id: string,
  batchId: string,
  archivedBy: string | null,
): Promise<void> {
  await tx.subscriber.update({
    where: { id },
    data: { archivedAt: new Date(), archivedBy, archiveBatchId: batchId, version: { increment: 1 } },
  });
}

export async function findSubscribersOfBatch(tx: DbOrTx, batchId: string): Promise<{ id: string; name: string }[]> {
  return tx.subscriber.findMany({ where: { archiveBatchId: batchId }, select: { id: true, name: true } });
}

export async function clearSubscriberBatch(tx: DbOrTx, batchId: string): Promise<void> {
  await tx.subscriber.updateMany({
    where: { archiveBatchId: batchId },
    data: { archivedAt: null, archivedBy: null, archiveBatchId: null, version: { increment: 1 } },
  });
}

// Only what the checks above left: a contact, a link and the periods go with the client, nothing cascades
export async function deleteSubscriberRows(tx: DbOrTx, id: string): Promise<void> {
  await tx.subscriberTariffPeriod.deleteMany({ where: { subscriberId: id } });
  await tx.contact.deleteMany({ where: { subscriberId: id } });
  await tx.payerSubscriber.deleteMany({ where: { subscriberId: id } });
  await tx.subscriber.delete({ where: { id } });
}

export interface RollupRow {
  id: string;
  status: Prisma.SubscriberGetPayload<object>["status"];
  objectsActive: number;
  objectsSuspended: number;
  objectsDisconnected: number;
}

export function readRollupPage(db: DbOrTx, afterId: string | null, limit: number): Promise<RollupRow[]> {
  return db.subscriber.findMany({
    where: afterId ? { id: { gt: afterId } } : {},
    orderBy: { id: "asc" },
    take: limit,
    select: { id: true, status: true, objectsActive: true, objectsSuspended: true, objectsDisconnected: true },
  });
}

// The version does not move: a form of the client has nothing against a change of one of its objects
export async function writeRollup(tx: DbOrTx, id: string, facts: ObjectCounts): Promise<void> {
  await tx.subscriber.update({ where: { id }, data: { ...facts, status: deriveSubscriberStatus(facts) } });
}

// Only when the row still says what was read: a change of an object in between has already put it right
export async function fixRollup(db: DbOrTx, row: RollupRow, facts: ObjectCounts): Promise<void> {
  const { id, ...seen } = row;
  await db.subscriber.updateMany({
    where: { id, ...seen },
    data: { ...facts, status: deriveSubscriberStatus(facts) },
  });
}
