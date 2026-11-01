import { normalizeName, reverseDigits, type DeviceStatus, type SimStatus } from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import type { DeviceOwnership, Prisma } from "../../generated/prisma/client.js";

const OBJECT_NAME = { select: { id: true, name: true } } as const;

const DEVICE_ROW = {
  id: true,
  version: true,
  imei: true,
  modelId: true,
  ownership: true,
  status: true,
  currentSimId: true,
  note: true,
  archivedAt: true,
  model: { select: { name: true } },
  object: OBJECT_NAME,
} satisfies Prisma.DeviceSelect;

export type DeviceRow = Prisma.DeviceGetPayload<{ select: typeof DEVICE_ROW }>;

const SIM_ROW = {
  id: true,
  version: true,
  iccid: true,
  msisdn: true,
  operatorId: true,
  planId: true,
  status: true,
  note: true,
  archivedAt: true,
  operator: { select: { name: true } },
  plan: { select: { name: true } },
  device: { select: { id: true, imei: true, object: OBJECT_NAME } },
} satisfies Prisma.SimSelect;

export type SimRow = Prisma.SimGetPayload<{ select: typeof SIM_ROW }>;

const SENSOR_ROW = {
  id: true,
  version: true,
  serialNo: true,
  note: true,
  archivedAt: true,
  installations: { where: { validTo: null }, select: { object: OBJECT_NAME } },
} satisfies Prisma.SensorSelect;

export type SensorRow = Prisma.SensorGetPayload<{ select: typeof SENSOR_ROW }>;

// NO KEY, as on clients: an installation pointing at a row does not wait for it. In the order of the id, so that two
// replacements of each other's trackers queue up instead of a deadlock.
export async function lockDevices(tx: DbOrTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT 1 FROM devices WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
}

export async function lockSims(tx: DbOrTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT 1 FROM sims WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
}

export async function lockSensors(tx: DbOrTx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT 1 FROM sensors WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
}

export function findDevice(db: DbOrTx, id: string): Promise<DeviceRow | null> {
  return db.device.findUnique({ where: { id }, select: DEVICE_ROW });
}

export function findTracker(db: DbOrTx, id: string) {
  return db.device.findUnique({
    where: { id },
    select: { imei: true, currentSim: { select: { id: true, iccid: true } } },
  });
}

export function findDeviceByImei(db: DbOrTx, imei: string): Promise<DeviceRow | null> {
  return db.device.findUnique({ where: { imei }, select: DEVICE_ROW });
}

export function findSim(db: DbOrTx, id: string): Promise<SimRow | null> {
  return db.sim.findUnique({ where: { id }, select: SIM_ROW });
}

export function findSimByIccid(db: DbOrTx, iccid: string): Promise<SimRow | null> {
  return db.sim.findUnique({ where: { iccid }, select: SIM_ROW });
}

export function findSensor(db: DbOrTx, id: string): Promise<SensorRow | null> {
  return db.sensor.findUnique({ where: { id }, select: SENSOR_ROW });
}

export function findSensorBySerial(db: DbOrTx, serialNo: string): Promise<SensorRow | null> {
  return db.sensor.findUnique({ where: { serialNo }, select: SENSOR_ROW });
}

export interface NewDevice {
  imei: string;
  modelId: string | null;
  ownership: DeviceOwnership | null;
  note: string | null;
  createdBy: string | null;
}

// ON CONFLICT DO NOTHING: a taken number costs a look at its holder and not the transaction (D71)
export async function insertDevice(tx: DbOrTx, input: NewDevice): Promise<string | null> {
  const { createdBy, ...fields } = input;
  const rows = await tx.device.createManyAndReturn({
    data: [{ ...fields, imeiRev: reverseDigits(input.imei), createdBy, updatedBy: createdBy }],
    skipDuplicates: true,
    select: { id: true },
  });
  return rows[0]?.id ?? null;
}

export interface NewSim {
  iccid: string;
  msisdn: string | null;
  operatorId: string | null;
  planId: string | null;
  note: string | null;
  createdBy: string | null;
}

export async function insertSim(tx: DbOrTx, input: NewSim): Promise<string | null> {
  const { createdBy, ...fields } = input;
  const rows = await tx.sim.createManyAndReturn({
    data: [
      {
        ...fields,
        iccidRev: reverseDigits(input.iccid),
        msisdnRev: input.msisdn && reverseDigits(input.msisdn),
        createdBy,
        updatedBy: createdBy,
      },
    ],
    skipDuplicates: true,
    select: { id: true },
  });
  return rows[0]?.id ?? null;
}

export async function insertSensor(
  tx: DbOrTx,
  input: { serialNo: string; note: string | null; createdBy: string | null },
): Promise<string | null> {
  const { serialNo, note, createdBy } = input;
  const rows = await tx.sensor.createManyAndReturn({
    data: [{ serialNo, serialNoNorm: normalizeName(serialNo), note, createdBy, updatedBy: createdBy }],
    skipDuplicates: true,
    select: { id: true },
  });
  return rows[0]?.id ?? null;
}

export interface DeviceChange {
  imei: string;
  modelId: string | null;
  ownership: DeviceOwnership | null;
  status: DeviceStatus;
  note: string | null;
}

export async function updateDevice(
  tx: DbOrTx,
  id: string,
  input: DeviceChange,
  updatedBy: string | null,
): Promise<void> {
  await tx.device.update({
    where: { id },
    data: { ...input, imeiRev: reverseDigits(input.imei), updatedBy, version: { increment: 1 } },
  });
}

export interface SimChange {
  iccid: string;
  msisdn: string | null;
  operatorId: string | null;
  planId: string | null;
  status: SimStatus;
  note: string | null;
}

export async function updateSim(tx: DbOrTx, id: string, input: SimChange, updatedBy: string | null): Promise<void> {
  await tx.sim.update({
    where: { id },
    data: {
      ...input,
      iccidRev: reverseDigits(input.iccid),
      msisdnRev: input.msisdn && reverseDigits(input.msisdn),
      updatedBy,
      version: { increment: 1 },
    },
  });
}

export async function updateSensor(
  tx: DbOrTx,
  id: string,
  input: { serialNo: string; note: string | null },
  updatedBy: string | null,
): Promise<void> {
  await tx.sensor.update({
    where: { id },
    data: { ...input, serialNoNorm: normalizeName(input.serialNo), updatedBy, version: { increment: 1 } },
  });
}

export type EquipmentKind = "device" | "sim" | "sensor";

function archiveFields(batchId: string, actorId: string | null) {
  return {
    archivedAt: new Date(),
    archivedBy: actorId,
    archiveBatchId: batchId,
    updatedBy: actorId,
    version: { increment: 1 },
  };
}

export async function markArchived(
  tx: DbOrTx,
  kind: EquipmentKind,
  id: string,
  batchId: string,
  actorId: string | null,
): Promise<void> {
  const data = archiveFields(batchId, actorId);
  if (kind === "device") await tx.device.update({ where: { id }, data });
  else if (kind === "sim") await tx.sim.update({ where: { id }, data });
  else await tx.sensor.update({ where: { id }, data });
}

export interface BatchRow {
  id: string;
  label: string;
}

export async function findBatchRows(tx: DbOrTx, kind: EquipmentKind, batchId: string): Promise<BatchRow[]> {
  const where = { archiveBatchId: batchId };
  if (kind === "device") {
    const rows = await tx.device.findMany({ where, select: { id: true, imei: true } });
    return rows.map((row) => ({ id: row.id, label: row.imei }));
  }
  if (kind === "sim") {
    const rows = await tx.sim.findMany({ where, select: { id: true, iccid: true } });
    return rows.map((row) => ({ id: row.id, label: row.iccid }));
  }
  const rows = await tx.sensor.findMany({ where, select: { id: true, serialNo: true } });
  return rows.map((row) => ({ id: row.id, label: row.serialNo }));
}

export async function clearBatch(tx: DbOrTx, kind: EquipmentKind, batchId: string): Promise<void> {
  const where = { archiveBatchId: batchId };
  const data = { archivedAt: null, archivedBy: null, archiveBatchId: null, version: { increment: 1 } };
  if (kind === "device") await tx.device.updateMany({ where, data });
  else if (kind === "sim") await tx.sim.updateMany({ where, data });
  else await tx.sensor.updateMany({ where, data });
}

export async function deleteRow(tx: DbOrTx, kind: EquipmentKind, id: string): Promise<void> {
  if (kind === "device") await tx.device.delete({ where: { id } });
  else if (kind === "sim") await tx.sim.delete({ where: { id } });
  else await tx.sensor.delete({ where: { id } });
}

export function countInstallations(tx: DbOrTx, kind: EquipmentKind, id: string): Promise<number> {
  if (kind === "device") return tx.deviceInstallation.count({ where: { deviceId: id } });
  if (kind === "sim") return tx.simInstallation.count({ where: { simId: id } });
  return tx.sensorInstallation.count({ where: { sensorId: id } });
}
