import { normalizeName, type ContractCreate, type ContractUpdate } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";
import type { Prisma } from "../../generated/prisma/client.js";

const CONTRACT_SELECT = {
  id: true,
  version: true,
  subscriberId: true,
  payerId: true,
  number: true,
  signedOn: true,
  validUntil: true,
  terminatedOn: true,
  note: true,
  archivedAt: true,
  archiveBatchId: true,
  payer: { select: { name: true } },
} satisfies Prisma.ContractSelect;

type RawContract = Prisma.ContractGetPayload<{ select: typeof CONTRACT_SELECT }>;

export interface ContractRow extends Omit<RawContract, "signedOn" | "validUntil" | "terminatedOn" | "payer"> {
  signedOn: string;
  validUntil: string;
  terminatedOn: string | null;
  payerName: string;
}

function toRow({ signedOn, validUntil, terminatedOn, payer, ...row }: RawContract): ContractRow {
  return {
    ...row,
    signedOn: fromDbDate(signedOn),
    validUntil: fromDbDate(validUntil),
    terminatedOn: terminatedOn && fromDbDate(terminatedOn),
    payerName: payer.name,
  };
}

export function scopedContract(scope: RecordScope): Prisma.ContractWhereInput {
  return scope.managerId ? { subscriber: { managerId: scope.managerId } } : {};
}

export async function findContract(db: DbOrTx, id: string, scope: RecordScope): Promise<ContractRow | null> {
  const row = await db.contract.findFirst({ where: { id, ...scopedContract(scope) }, select: CONTRACT_SELECT });
  return row && toRow(row);
}

function dateColumns(input: ContractCreate) {
  return {
    payerId: input.payerId,
    number: input.number,
    numberNorm: normalizeName(input.number),
    signedOn: toDbDate(input.signedOn),
    validUntil: toDbDate(input.validUntil),
    terminatedOn: input.terminatedOn ? toDbDate(input.terminatedOn) : null,
    note: input.note,
  };
}

export async function createContract(
  tx: DbOrTx,
  subscriberId: string,
  input: ContractCreate,
  createdBy: string | null,
): Promise<string> {
  const { id } = await tx.contract.create({
    data: { ...dateColumns(input), subscriberId, createdBy, updatedBy: createdBy },
    select: { id: true },
  });
  return id;
}

export async function updateContract(
  tx: DbOrTx,
  id: string,
  input: ContractUpdate,
  updatedBy: string | null,
): Promise<void> {
  await tx.contract.update({
    where: { id },
    data: { ...dateColumns(input), updatedBy, version: { increment: 1 } },
  });
}

export async function findActiveContracts(tx: DbOrTx, subscriberId: string): Promise<{ id: string; number: string }[]> {
  return tx.contract.findMany({ where: { subscriberId, archivedAt: null }, select: { id: true, number: true } });
}

export async function archiveContracts(
  tx: DbOrTx,
  ids: string[],
  batchId: string,
  archivedBy: string | null,
): Promise<void> {
  await tx.contract.updateMany({
    where: { id: { in: ids } },
    data: { archivedAt: new Date(), archivedBy, archiveBatchId: batchId, version: { increment: 1 } },
  });
}

export interface ContractOfBatch {
  id: string;
  number: string;
  numberNorm: string;
  subscriberId: string;
  payerId: string;
  subscriber: { name: string; archivedAt: Date | null };
  payer: { name: string; archivedAt: Date | null };
}

export function findContractsOfBatch(tx: DbOrTx, batchId: string): Promise<ContractOfBatch[]> {
  return tx.contract.findMany({
    where: { archiveBatchId: batchId },
    select: {
      id: true,
      number: true,
      numberNorm: true,
      subscriberId: true,
      payerId: true,
      subscriber: { select: { name: true, archivedAt: true } },
      payer: { select: { name: true, archivedAt: true } },
    },
  });
}

// Only the contracts this person may see: a hint must not read out the payers of someone else's client
export function findNumberHolders(
  db: DbOrTx,
  scope: RecordScope,
  number: string,
  excludeId: string | undefined,
): Promise<{ id: string; subscriberId: string; payerId: string; payer: { name: string } }[]> {
  return db.contract.findMany({
    where: {
      ...scopedContract(scope),
      numberNorm: normalizeName(number),
      archivedAt: null,
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    take: 20,
    orderBy: { id: "asc" },
    select: { id: true, subscriberId: true, payerId: true, payer: { select: { name: true } } },
  });
}

export async function isNumberHeld(
  tx: DbOrTx,
  contract: Pick<ContractOfBatch, "id" | "payerId" | "numberNorm">,
): Promise<boolean> {
  const { id, payerId, numberNorm } = contract;
  const count = await tx.contract.count({ where: { payerId, numberNorm, archivedAt: null, NOT: { id } } });
  return count > 0;
}

export async function clearContractBatch(tx: DbOrTx, batchId: string): Promise<void> {
  await tx.contract.updateMany({
    where: { archiveBatchId: batchId },
    data: { archivedAt: null, archivedBy: null, archiveBatchId: null, version: { increment: 1 } },
  });
}
