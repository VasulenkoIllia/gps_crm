import type { DeviceStatus } from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";

export interface NewInstallation {
  validFrom: string;
  contractorId: string | null;
  actorId: string | null;
}

export async function openDeviceInstallation(
  tx: DbOrTx,
  objectId: string,
  deviceId: string,
  { validFrom, contractorId, actorId }: NewInstallation,
): Promise<void> {
  await tx.deviceInstallation.create({
    data: { objectId, deviceId, contractorId, validFrom: toDbDate(validFrom), createdBy: actorId },
  });
  await tx.device.update({
    where: { id: deviceId },
    data: { status: "installed", updatedBy: actorId, version: { increment: 1 } },
  });
}

export async function openSimInstallation(
  tx: DbOrTx,
  deviceId: string,
  simId: string,
  { validFrom, contractorId, actorId }: NewInstallation,
): Promise<void> {
  await tx.simInstallation.create({
    data: { deviceId, simId, contractorId, validFrom: toDbDate(validFrom), createdBy: actorId },
  });
  await tx.device.update({ where: { id: deviceId }, data: { currentSimId: simId, updatedBy: actorId } });
  // Only a free one: a blocked SIM moved to the next tracker stays blocked, the operator has not changed its mind
  await tx.sim.updateMany({
    where: { id: simId, status: "free" },
    data: { status: "active", updatedBy: actorId, version: { increment: 1 } },
  });
}

export async function openSensorInstallation(
  tx: DbOrTx,
  objectId: string,
  sensorId: string,
  { validFrom, contractorId, actorId }: NewInstallation,
): Promise<void> {
  await tx.sensorInstallation.create({
    data: { objectId, sensorId, contractorId, validFrom: toDbDate(validFrom), createdBy: actorId },
  });
}

export async function closeDeviceInstallations(tx: DbOrTx, deviceIds: string[], validTo: string): Promise<void> {
  await tx.deviceInstallation.updateMany({
    where: { deviceId: { in: deviceIds }, validTo: null },
    data: { validTo: toDbDate(validTo) },
  });
}

export async function closeSimInstallations(tx: DbOrTx, deviceIds: string[], validTo: string): Promise<void> {
  await tx.simInstallation.updateMany({
    where: { deviceId: { in: deviceIds }, validTo: null },
    data: { validTo: toDbDate(validTo) },
  });
}

export async function closeSensorInstallations(
  tx: DbOrTx,
  where: { objectIds: string[]; sensorId?: string },
  validTo: string,
): Promise<number> {
  const { count } = await tx.sensorInstallation.updateMany({
    where: {
      objectId: { in: where.objectIds },
      validTo: null,
      ...(where.sensorId ? { sensorId: where.sensorId } : {}),
    },
    data: { validTo: toDbDate(validTo) },
  });
  return count;
}

export async function markDevicesOff(
  tx: DbOrTx,
  ids: string[],
  status: DeviceStatus,
  actorId: string | null,
): Promise<void> {
  await tx.device.updateMany({
    where: { id: { in: ids } },
    data: { status, currentSimId: null, updatedBy: actorId, version: { increment: 1 } },
  });
}

export async function clearCurrentSim(tx: DbOrTx, deviceId: string, actorId: string | null): Promise<void> {
  await tx.device.update({ where: { id: deviceId }, data: { currentSimId: null, updatedBy: actorId } });
}

export async function markSimsFree(tx: DbOrTx, ids: string[], actorId: string | null): Promise<void> {
  await tx.sim.updateMany({
    where: { id: { in: ids }, status: "active" },
    data: { status: "free", updatedBy: actorId, version: { increment: 1 } },
  });
}

export async function findCurrentSimIds(tx: DbOrTx, deviceIds: string[]): Promise<string[]> {
  const rows = await tx.device.findMany({
    where: { id: { in: deviceIds }, currentSimId: { not: null } },
    select: { currentSimId: true },
  });
  return rows.flatMap((row) => (row.currentSimId ? [row.currentSimId] : []));
}

export interface InstallationFact {
  validFrom: string;
  validTo: string | null;
}

function toFact(row: { validFrom: Date; validTo: Date | null }): InstallationFact {
  return { validFrom: fromDbDate(row.validFrom), validTo: row.validTo && fromDbDate(row.validTo) };
}

const DATES = { validFrom: true, validTo: true } as const;
const LATEST = { validFrom: "desc" } as const;

export async function latestDeviceInstallation(tx: DbOrTx, deviceId: string): Promise<InstallationFact | null> {
  const row = await tx.deviceInstallation.findFirst({ where: { deviceId }, orderBy: LATEST, select: DATES });
  return row && toFact(row);
}

export async function latestInstallationOnObject(tx: DbOrTx, objectId: string): Promise<InstallationFact | null> {
  const row = await tx.deviceInstallation.findFirst({ where: { objectId }, orderBy: LATEST, select: DATES });
  return row && toFact(row);
}

export async function latestInstallationInDevice(tx: DbOrTx, deviceId: string): Promise<InstallationFact | null> {
  const row = await tx.simInstallation.findFirst({ where: { deviceId }, orderBy: LATEST, select: DATES });
  return row && toFact(row);
}

export async function latestSimInstallation(tx: DbOrTx, simId: string): Promise<InstallationFact | null> {
  const row = await tx.simInstallation.findFirst({ where: { simId }, orderBy: LATEST, select: DATES });
  return row && toFact(row);
}

export async function latestSensorInstallation(tx: DbOrTx, sensorId: string): Promise<InstallationFact | null> {
  const row = await tx.sensorInstallation.findFirst({ where: { sensorId }, orderBy: LATEST, select: DATES });
  return row && toFact(row);
}

export async function findOpenSensorInstallation(
  tx: DbOrTx,
  objectId: string,
  sensorId: string,
): Promise<InstallationFact | null> {
  const row = await tx.sensorInstallation.findFirst({ where: { objectId, sensorId, validTo: null }, select: DATES });
  return row && toFact(row);
}

// A mistake undone leaves no trace on the equipment: the journal of the object keeps the record (objects.md П17)
export async function deleteInstallationsOf(tx: DbOrTx, objectId: string, deviceIds: string[]): Promise<void> {
  await tx.sensorInstallation.deleteMany({ where: { objectId } });
  await tx.simInstallation.deleteMany({ where: { deviceId: { in: deviceIds }, validTo: null } });
  await tx.deviceInstallation.deleteMany({ where: { objectId } });
}
