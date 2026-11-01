import { normalizeName, type ObjectStatus } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";
import type { Prisma } from "../../generated/prisma/client.js";

const OBJECT_ROW = {
  id: true,
  version: true,
  subscriberId: true,
  name: true,
  status: true,
  statusFrom: true,
  connectedOn: true,
  disconnectedOn: true,
  disconnectReasonId: true,
  payerId: true,
  tariffId: true,
  programId: true,
  serverId: true,
  hasOwnTariff: true,
  currentDeviceId: true,
  note: true,
  archivedAt: true,
} satisfies Prisma.MonitoredObjectSelect;

type RawRow = Prisma.MonitoredObjectGetPayload<{ select: typeof OBJECT_ROW }>;

export interface ObjectRow extends Omit<RawRow, "statusFrom" | "connectedOn" | "disconnectedOn"> {
  statusFrom: string;
  connectedOn: string;
  disconnectedOn: string | null;
}

function toRow({ statusFrom, connectedOn, disconnectedOn, ...row }: RawRow): ObjectRow {
  return {
    ...row,
    statusFrom: fromDbDate(statusFrom),
    connectedOn: fromDbDate(connectedOn),
    disconnectedOn: disconnectedOn && fromDbDate(disconnectedOn),
  };
}

export function objectWhere(scope: RecordScope): Prisma.MonitoredObjectWhereInput {
  return scope.managerId ? { subscriber: { managerId: scope.managerId } } : {};
}

export async function findClientOf(db: DbOrTx, id: string, scope: RecordScope): Promise<string | null> {
  const row = await db.monitoredObject.findFirst({
    where: { id, ...objectWhere(scope) },
    select: { subscriberId: true },
  });
  return row?.subscriberId ?? null;
}

export async function lockRow(tx: DbOrTx, id: string): Promise<ObjectRow | null> {
  await tx.$queryRaw`SELECT 1 FROM objects WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
  const row = await tx.monitoredObject.findUnique({ where: { id }, select: OBJECT_ROW });
  return row && toRow(row);
}

export interface NewObject {
  subscriberId: string;
  name: string;
  status: ObjectStatus;
  statusFrom: string;
  connectedOn: string;
  disconnectReasonId: string | null;
  payerId: string;
  tariff: TariffMirror;
  hasOwnTariff: boolean;
  currentDeviceId: string;
  note: string | null;
  createdBy: string | null;
}

export interface TariffMirror {
  tariffId: string;
  programId: string;
  serverId: string;
}

export async function insertObject(tx: DbOrTx, input: NewObject): Promise<string> {
  const { tariff, statusFrom, connectedOn, createdBy, ...fields } = input;
  const { tariffId, programId, serverId } = tariff;
  const row = await tx.monitoredObject.create({
    data: {
      ...fields,
      tariffId,
      programId,
      serverId,
      nameNorm: normalizeName(input.name),
      statusFrom: toDbDate(statusFrom),
      connectedOn: toDbDate(connectedOn),
      disconnectedOn: input.status === "disconnected" ? toDbDate(statusFrom) : null,
      createdBy,
      updatedBy: createdBy,
    },
    select: { id: true },
  });
  return row.id;
}

export async function updateObject(
  tx: DbOrTx,
  id: string,
  input: { name: string; note: string | null },
  updatedBy: string | null,
): Promise<void> {
  await tx.monitoredObject.update({
    where: { id },
    data: { ...input, nameNorm: normalizeName(input.name), updatedBy, version: { increment: 1 } },
  });
}

export interface NewStatusPeriod {
  status: ObjectStatus;
  validFrom: string;
  reasonId: string | null;
  note: string | null;
  createdBy: string | null;
}

export async function openStatusPeriod(tx: DbOrTx, objectId: string, period: NewStatusPeriod): Promise<void> {
  const { validFrom, ...fields } = period;
  await tx.objectStatusPeriod.create({ data: { ...fields, objectId, validFrom: toDbDate(validFrom) } });
}

export async function closeStatusPeriod(tx: DbOrTx, objectId: string, validTo: string): Promise<void> {
  await tx.objectStatusPeriod.updateMany({
    where: { objectId, validTo: null },
    data: { validTo: toDbDate(validTo) },
  });
}

// The version moves on a change of the record and on the archive, not on an action with a date of its own (D61): a form
// of the name stays open across a change of status
export async function mirrorStatus(
  tx: DbOrTx,
  id: string,
  period: NewStatusPeriod,
  updatedBy: string | null,
): Promise<void> {
  const validFrom = toDbDate(period.validFrom);
  const isOff = period.status === "disconnected";
  await tx.monitoredObject.update({
    where: { id },
    data: {
      status: period.status,
      statusFrom: validFrom,
      disconnectedOn: isOff ? validFrom : null,
      disconnectReasonId: isOff ? period.reasonId : null,
      updatedBy,
    },
  });
}

export interface TermRow {
  id: string;
  payerId: string;
  ownTariffId: string | null;
  validFrom: string;
  validTo: string | null;
}

export async function findTerms(tx: DbOrTx, objectId: string): Promise<TermRow[]> {
  const rows = await tx.objectServiceTerm.findMany({
    where: { objectId },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    select: { id: true, payerId: true, ownTariffId: true, validFrom: true, validTo: true },
  });
  return rows.map(({ validFrom, validTo, ...row }) => ({
    ...row,
    validFrom: fromDbDate(validFrom),
    validTo: validTo && fromDbDate(validTo),
  }));
}

export interface NewTerm {
  payerId: string;
  ownTariffId: string | null;
  validFrom: string;
  validTo: string | null;
  createdBy: string | null;
}

export async function openTerm(tx: DbOrTx, objectId: string, term: NewTerm): Promise<void> {
  const { validFrom, validTo, ...fields } = term;
  await tx.objectServiceTerm.create({
    data: { ...fields, objectId, validFrom: toDbDate(validFrom), validTo: validTo && toDbDate(validTo) },
  });
}

export async function closeTerm(tx: DbOrTx, id: string, validTo: string): Promise<void> {
  await tx.objectServiceTerm.update({ where: { id }, data: { validTo: toDbDate(validTo) } });
}

export async function setTermPayer(tx: DbOrTx, id: string, payerId: string): Promise<void> {
  await tx.objectServiceTerm.update({ where: { id }, data: { payerId } });
}

export interface TermsMirror extends TariffMirror {
  payerId: string;
  hasOwnTariff: boolean;
}

export async function mirrorTerms(
  tx: DbOrTx,
  id: string,
  mirror: TermsMirror,
  updatedBy: string | null,
): Promise<void> {
  await tx.monitoredObject.update({ where: { id }, data: { ...mirror, updatedBy } });
}

export async function followTariff(
  tx: DbOrTx,
  subscriberId: string,
  tariff: TariffMirror,
  updatedBy: string | null,
): Promise<void> {
  await tx.monitoredObject.updateMany({
    where: { subscriberId, hasOwnTariff: false },
    data: { ...tariff, updatedBy },
  });
}

export async function setCurrentDevice(
  tx: DbOrTx,
  id: string,
  currentDeviceId: string,
  updatedBy: string | null,
): Promise<void> {
  await tx.monitoredObject.update({ where: { id }, data: { currentDeviceId, updatedBy } });
}

export interface AddonPeriod {
  id: string;
  validFrom: string;
  validTo: string | null;
}

export async function findAddonPeriods(tx: DbOrTx, objectId: string, addonId: string): Promise<AddonPeriod[]> {
  const rows = await tx.objectAddonPeriod.findMany({
    where: { objectId, addonId },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    select: { id: true, validFrom: true, validTo: true },
  });
  return rows.map(({ id, validFrom, validTo }) => ({
    id,
    validFrom: fromDbDate(validFrom),
    validTo: validTo && fromDbDate(validTo),
  }));
}

export async function openAddon(
  tx: DbOrTx,
  objectId: string,
  addonId: string,
  validFrom: string,
  createdBy: string | null,
): Promise<void> {
  await tx.objectAddonPeriod.create({ data: { objectId, addonId, validFrom: toDbDate(validFrom), createdBy } });
}

export async function closeAddon(tx: DbOrTx, id: string, validTo: string): Promise<void> {
  await tx.objectAddonPeriod.update({ where: { id }, data: { validTo: toDbDate(validTo) } });
}

export interface LiveObject {
  id: string;
  name: string;
  currentDeviceId: string | null;
}

export function findLiveObjectsOf(tx: DbOrTx, subscriberId: string): Promise<LiveObject[]> {
  return tx.monitoredObject.findMany({
    where: { subscriberId, archivedAt: null },
    select: { id: true, name: true, currentDeviceId: true },
  });
}

// D71: what stood on the object has been let go by now, so it comes back with nothing on it
export async function archiveObjects(
  tx: DbOrTx,
  ids: string[],
  batchId: string,
  archivedBy: string | null,
): Promise<void> {
  await tx.monitoredObject.updateMany({
    where: { id: { in: ids } },
    data: {
      archivedAt: new Date(),
      archivedBy,
      archiveBatchId: batchId,
      currentDeviceId: null,
      updatedBy: archivedBy,
      version: { increment: 1 },
    },
  });
}

export interface BatchObject {
  id: string;
  name: string;
  subscriberId: string;
  subscriber: { name: string; archivedAt: Date | null };
}

export function findObjectsOfBatch(tx: DbOrTx, batchId: string): Promise<BatchObject[]> {
  return tx.monitoredObject.findMany({
    where: { archiveBatchId: batchId },
    select: {
      id: true,
      name: true,
      subscriberId: true,
      subscriber: { select: { name: true, archivedAt: true } },
    },
  });
}

export async function clearObjectBatch(tx: DbOrTx, batchId: string): Promise<void> {
  await tx.monitoredObject.updateMany({
    where: { archiveBatchId: batchId },
    data: { archivedAt: null, archivedBy: null, archiveBatchId: null, version: { increment: 1 } },
  });
}

export async function countHistory(tx: DbOrTx, object: Pick<ObjectRow, "id" | "currentDeviceId">) {
  const [statuses, devices, firstDevice, closedSensors] = await Promise.all([
    tx.objectStatusPeriod.count({ where: { objectId: object.id } }),
    tx.deviceInstallation.count({ where: { objectId: object.id } }),
    tx.deviceInstallation.findFirst({
      where: { objectId: object.id },
      orderBy: { validFrom: "asc" },
      select: { validFrom: true },
    }),
    tx.sensorInstallation.count({ where: { objectId: object.id, validTo: { not: null } } }),
  ]);
  // A tracker keeps the SIM records of its earlier lives: only those from this object on are its history
  const sims =
    object.currentDeviceId && firstDevice
      ? await tx.simInstallation.count({
          where: { deviceId: object.currentDeviceId, validFrom: { gte: firstDevice.validFrom } },
        })
      : 0;
  return { statuses, devices, sims, closedSensors };
}

// Only what the checks left: the first version of everything, and nothing cascades
export async function deleteObjectRows(tx: DbOrTx, id: string): Promise<void> {
  await tx.objectAddonPeriod.deleteMany({ where: { objectId: id } });
  await tx.objectServiceTerm.deleteMany({ where: { objectId: id } });
  await tx.objectStatusPeriod.deleteMany({ where: { objectId: id } });
  await tx.monitoredObject.delete({ where: { id } });
}
