import {
  normalizeName,
  type BillingModel,
  type CostSubjectType,
  type DatedPrice,
  type ReferenceKind,
  type ServerCreate,
  type SimpleReferenceInput,
  type SimpleReferenceKind,
  type SimPlanCreate,
  type TariffCreate,
} from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";

const REFERENCES_LOCK = 7_204_512;

const NAMED_SELECT = { id: true, name: true, isActive: true, version: true } as const;
const SIMPLE_SELECT = { ...NAMED_SELECT, note: true, sortOrder: true } as const;

export interface NamedRecord {
  id: string;
  name: string;
  isActive: boolean;
  version: number;
}

interface SimpleRow extends NamedRecord {
  note: string | null;
  sortOrder: number;
}

interface ReferenceTable {
  findUnique(args: { where: { id: string }; select: typeof NAMED_SELECT }): Promise<NamedRecord | null>;
  findMany(args: { where: Record<string, unknown>; select: typeof NAMED_SELECT }): Promise<NamedRecord[]>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
}

interface SimpleTable {
  findUnique(args: { where: { id: string }; select: typeof SIMPLE_SELECT }): Promise<SimpleRow | null>;
  findMany(args: Record<string, unknown> & { select: typeof SIMPLE_SELECT }): Promise<SimpleRow[]>;
  create(args: { data: Record<string, unknown>; select: { id: true } }): Promise<{ id: string }>;
}

const TABLES: Record<ReferenceKind, (db: DbOrTx) => unknown> = {
  programs: (db) => db.program,
  servers: (db) => db.monitoringServer,
  tariffs: (db) => db.tariff,
  addons: (db) => db.addon,
  "tracker-models": (db) => db.trackerModel,
  "sim-operators": (db) => db.simOperator,
  "sim-plans": (db) => db.simPlan,
  contractors: (db) => db.contractor,
  "disconnect-reasons": (db) => db.disconnectReason,
};

// Prisma types each table on its own and a union of them cannot be called, so what the tables share is named here once
function tableOf(db: DbOrTx, kind: ReferenceKind): ReferenceTable {
  return TABLES[kind](db) as ReferenceTable;
}

export function simpleTable(db: DbOrTx, kind: SimpleReferenceKind): SimpleTable {
  return TABLES[kind](db) as SimpleTable;
}

export const SIMPLE_ROW = SIMPLE_SELECT;

// Changes here are rare and lean on each other: a child and its parent, a price and the one before it. So they run one at
// a time, and the check a service makes still holds when it writes.
export async function lockReferences(tx: DbOrTx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REFERENCES_LOCK}::bigint)`;
}

export function findNamed(db: DbOrTx, kind: ReferenceKind, id: string): Promise<NamedRecord | null> {
  return tableOf(db, kind).findUnique({ where: { id }, select: NAMED_SELECT });
}

// `where` may carry a condition besides the id: a count of 0 then means the row stopped meeting it
export async function updateRecord(
  db: DbOrTx,
  kind: ReferenceKind,
  where: { id: string; selectedAt?: null },
  values: Record<string, unknown>,
  updatedBy: string | null,
): Promise<number> {
  const nameNorm = typeof values.name === "string" ? { nameNorm: normalizeName(values.name) } : {};
  const { count } = await tableOf(db, kind).updateMany({
    where,
    data: { ...values, ...nameNorm, version: { increment: 1 }, updatedBy },
  });
  return count;
}

export function findActiveChildren(
  db: DbOrTx,
  kind: ReferenceKind,
  parentField: string,
  parentId: string,
): Promise<NamedRecord[]> {
  return tableOf(db, kind).findMany({ where: { [parentField]: parentId, isActive: true }, select: NAMED_SELECT });
}

export function findInBatch(db: DbOrTx, kind: ReferenceKind, batchId: string): Promise<NamedRecord[]> {
  return tableOf(db, kind).findMany({ where: { archiveBatchId: batchId }, select: NAMED_SELECT });
}

export async function deactivateRecords(
  db: DbOrTx,
  kind: ReferenceKind,
  ids: string[],
  batchId: string,
  updatedBy: string | null,
): Promise<void> {
  await tableOf(db, kind).updateMany({
    where: { id: { in: ids } },
    data: { isActive: false, archiveBatchId: batchId, version: { increment: 1 }, updatedBy },
  });
}

export async function activateBatch(
  db: DbOrTx,
  kind: ReferenceKind,
  batchId: string,
  updatedBy: string | null,
): Promise<void> {
  await tableOf(db, kind).updateMany({
    where: { archiveBatchId: batchId },
    data: { isActive: true, archiveBatchId: null, version: { increment: 1 }, updatedBy },
  });
}

export interface InactiveParent {
  kind: ReferenceKind;
  name: string;
}

function firstInactive(parents: (InactiveParent & { isActive: boolean })[]): InactiveParent | null {
  return parents.find((parent) => !parent.isActive) ?? null;
}

// After a package came back: a record of it whose parent is still out, because the parent left in a later package
export async function findInactiveParent(db: DbOrTx, ids: Partial<Record<ReferenceKind, string[]>>) {
  const parent = { select: { name: true, isActive: true } } as const;
  const tariff = await db.tariff.findFirst({
    where: { id: { in: ids.tariffs ?? [] }, OR: [{ program: { isActive: false } }, { server: { isActive: false } }] },
    select: { program: parent, server: parent },
  });
  if (tariff) {
    return firstInactive([
      { kind: "programs", ...tariff.program },
      { kind: "servers", ...tariff.server },
    ]);
  }
  const server = await db.monitoringServer.findFirst({
    where: { id: { in: ids.servers ?? [] }, program: { isActive: false } },
    select: { program: parent },
  });
  if (server) return firstInactive([{ kind: "programs", ...server.program }]);
  const plan = await db.simPlan.findFirst({
    where: { id: { in: ids["sim-plans"] ?? [] }, operator: { isActive: false } },
    select: { operator: parent },
  });
  return plan ? firstInactive([{ kind: "sim-operators", ...plan.operator }]) : null;
}

export function createSimple(
  db: DbOrTx,
  kind: SimpleReferenceKind,
  input: SimpleReferenceInput,
  createdBy: string | null,
): Promise<{ id: string }> {
  return simpleTable(db, kind).create({
    data: { ...input, nameNorm: normalizeName(input.name), createdBy },
    select: { id: true },
  });
}

export function findSimple(db: DbOrTx, kind: SimpleReferenceKind, id: string): Promise<SimpleRow | null> {
  return simpleTable(db, kind).findUnique({ where: { id }, select: SIMPLE_SELECT });
}

export function createServer(
  db: DbOrTx,
  input: Omit<ServerCreate, "firstCost">,
  createdBy: string | null,
): Promise<{ id: string }> {
  return db.monitoringServer.create({
    data: { ...input, nameNorm: normalizeName(input.name), createdBy },
    select: { id: true },
  });
}

export function findServer(db: DbOrTx, id: string) {
  return db.monitoringServer.findUnique({
    where: { id },
    select: { ...NAMED_SELECT, url: true, programId: true, program: { select: { name: true } } },
  });
}

export function countServerTariffs(db: DbOrTx, serverId: string): Promise<number> {
  return db.tariff.count({ where: { serverId } });
}

export function createSimPlan(
  db: DbOrTx,
  input: Omit<SimPlanCreate, "firstCost">,
  createdBy: string | null,
): Promise<{ id: string }> {
  return db.simPlan.create({
    data: { ...input, nameNorm: normalizeName(input.name), createdBy },
    select: { id: true },
  });
}

export function findSimPlan(db: DbOrTx, id: string) {
  return db.simPlan.findUnique({
    where: { id },
    select: { ...SIMPLE_SELECT, operatorId: true, operator: { select: { name: true } } },
  });
}

export function createTariff(db: DbOrTx, input: TariffCreate, createdBy: string | null): Promise<{ id: string }> {
  const { priceKop, ...fields } = input;
  return db.tariff.create({
    data: { ...fields, nameNorm: normalizeName(input.name), priceKop: BigInt(priceKop), createdBy },
    select: { id: true },
  });
}

export interface TariffRow extends NamedRecord {
  programId: string;
  serverId: string;
  billingModel: BillingModel;
  priceKop: number;
  isSelected: boolean;
  programName: string;
  serverName: string;
}

// By the module that takes the tariff: `references` knows the column and nothing about who took it (D55)
export async function markTariffSelected(db: DbOrTx, programId: string, id: string): Promise<void> {
  await db.tariff.updateMany({
    where: { id, programId, isActive: true, selectedAt: null },
    data: { selectedAt: new Date() },
  });
}

export async function findTariff(db: DbOrTx, id: string): Promise<TariffRow | null> {
  const row = await db.tariff.findUnique({
    where: { id },
    select: {
      ...NAMED_SELECT,
      programId: true,
      serverId: true,
      billingModel: true,
      priceKop: true,
      selectedAt: true,
      program: { select: { name: true } },
      server: { select: { name: true } },
    },
  });
  if (!row) return null;
  const { program, server, selectedAt, priceKop, ...fields } = row;
  return {
    ...fields,
    priceKop: Number(priceKop),
    isSelected: selectedAt !== null,
    programName: program.name,
    serverName: server.name,
  };
}

export function toPriceColumn(priceKop: number): bigint {
  return BigInt(priceKop);
}

export function createAddon(db: DbOrTx, name: string, createdBy: string | null): Promise<{ id: string }> {
  return db.addon.create({ data: { name, nameNorm: normalizeName(name), createdBy }, select: { id: true } });
}

export async function findAddon(db: DbOrTx, id: string) {
  return db.addon.findUnique({
    where: { id },
    select: { ...NAMED_SELECT, programs: { select: { program: { select: { id: true, name: true } } } } },
  });
}

export function findPrograms(db: DbOrTx, ids: string[]) {
  return db.program.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true } });
}

export async function replaceAddonPrograms(tx: DbOrTx, addonId: string, programIds: string[]): Promise<void> {
  await tx.addonProgram.deleteMany({ where: { addonId } });
  await tx.addonProgram.createMany({ data: programIds.map((programId) => ({ addonId, programId })) });
}

export async function addAddonPriceRow(
  db: DbOrTx,
  addonId: string,
  price: DatedPrice,
  createdBy: string | null,
): Promise<void> {
  await db.addonPrice.create({
    data: {
      addonId,
      priceKop: BigInt(price.amountKop),
      validFrom: toDbDate(price.validFrom),
      createdBy,
    },
  });
}

export async function lastAddonPriceDate(db: DbOrTx, addonId: string): Promise<string | null> {
  const last = await db.addonPrice.findFirst({
    where: { addonId },
    orderBy: { validFrom: "desc" },
    select: { validFrom: true },
  });
  return last ? fromDbDate(last.validFrom) : null;
}

export async function addCostRow(
  db: DbOrTx,
  subjectType: CostSubjectType,
  subjectId: string,
  price: DatedPrice,
  createdBy: string | null,
): Promise<void> {
  await db.costPrice.create({
    data: {
      subjectType,
      subjectId,
      costKop: BigInt(price.amountKop),
      validFrom: toDbDate(price.validFrom),
      createdBy,
    },
  });
}

export async function lastCostDate(
  db: DbOrTx,
  subjectType: CostSubjectType,
  subjectId: string,
): Promise<string | null> {
  const last = await db.costPrice.findFirst({
    where: { subjectType, subjectId },
    orderBy: { validFrom: "desc" },
    select: { validFrom: true },
  });
  return last ? fromDbDate(last.validFrom) : null;
}
