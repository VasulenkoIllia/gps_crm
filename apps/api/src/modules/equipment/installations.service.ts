import { dateText, type DeviceChoice, type SensorChoice, type SimChoice } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivity,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import { AppError } from "../../core/errors.js";
import { requireActive } from "../references/index.js";
import * as repo from "./equipment.repository.js";
import * as installed from "./installations.repository.js";
import { assertModel, assertSimReferences, simConflict } from "./equipment.service.js";

const NOT_AVAILABLE = "Цей запис уже недоступний. Оберіть інший";
const CONTRACTOR_TEXT = "Оберіть підрядника";
const IN_ARCHIVE = "в архіві: спершу відновіть";

export interface Installation {
  validFrom: string;
  contractorId: string | null;
  actorId: string | null;
}

export interface TakenDevice {
  id: string;
  imei: string;
  currentSimId: string | null;
}

export interface TakenSim {
  id: string;
  iccid: string;
}

export interface TakenSensor {
  id: string;
  serialNo: string;
}

function refused(field: string, message: string): AppError {
  return new AppError(409, "equipment_unavailable", message, { [field]: message });
}

// A person at the level `own` works with their clients: the name of an object of another manager stays out of the answer
function whereItStands(name: string | undefined, scope: RecordScope): string {
  return name && !scope.managerId ? `на об'єкті «${name}»` : "на іншому об'єкті";
}

function assertDeviceFree(device: repo.DeviceRow, field: string, scope: RecordScope): void {
  if (device.archivedAt) throw refused(field, `Трекер з IMEI ${device.imei} ${IN_ARCHIVE} його`);
  if (device.object) {
    const message = `Трекер з IMEI ${device.imei} уже встановлений ${whereItStands(device.object.name, scope)}`;
    throw refused(field, message);
  }
  if (device.status !== "removed") throw refused(field, `Трекер з IMEI ${device.imei} у ремонті або списаний`);
}

function assertSimFree(sim: repo.SimRow, field: string): void {
  if (sim.archivedAt) throw refused(field, `SIM ${sim.iccid} ${IN_ARCHIVE} її`);
  if (sim.device) throw refused(field, `SIM ${sim.iccid} уже в трекері ${sim.device.imei}`);
  if (sim.status === "blocked") throw refused(field, `SIM ${sim.iccid} заблокована`);
}

function assertSensorFree(sensor: repo.SensorRow, field: string, scope: RecordScope): void {
  if (sensor.archivedAt) throw refused(field, `Датчик ${sensor.serialNo} ${IN_ARCHIVE} його`);
  const [open] = sensor.installations;
  if (open) {
    const message = `Датчик ${sensor.serialNo} уже встановлений ${whereItStands(open.object.name, scope)}`;
    throw refused(field, message);
  }
}

// Registered on the spot, so it gets the line of the journal a registration has
function recordRegistered(
  tx: DbOrTx,
  context: ActivityContext,
  action: ActivityEventInput["action"],
  entityType: string,
  entityId: string,
  label: string,
): Promise<void> {
  return recordActivity(tx, context, { action, entityType, entityId, details: { label } });
}

async function requireFreeDevice(tx: DbOrTx, id: string, field: string, scope: RecordScope): Promise<TakenDevice> {
  await repo.lockDevices(tx, [id]);
  const device = await repo.findDevice(tx, id);
  if (!device) throw refused(field, NOT_AVAILABLE);
  assertDeviceFree(device, field, scope);
  return device;
}

// objects.md П1: one from the list, or a number typed in: a new tracker, or the free one that has it
// A tracker typed by its number is one of the two a swap locks, so its id has to be known before the first lock
export async function deviceIdOf(tx: DbOrTx, { deviceId, imei }: DeviceChoice): Promise<string | null> {
  if (deviceId) return deviceId;
  return imei ? ((await repo.findDeviceByImei(tx, imei))?.id ?? null) : null;
}

export async function takeDevice(
  tx: DbOrTx,
  context: ActivityContext,
  scope: RecordScope,
  { deviceId, imei, modelId }: DeviceChoice,
): Promise<TakenDevice> {
  if (deviceId) return requireFreeDevice(tx, deviceId, "device.deviceId", scope);
  if (!imei) throw refused("device.imei", NOT_AVAILABLE);
  await assertModel(tx, modelId ?? null, "device.modelId");
  const id = await repo.insertDevice(tx, {
    imei,
    modelId: modelId ?? null,
    ownership: null,
    note: null,
    createdBy: actorIdOf(context),
  });
  if (id) {
    await recordRegistered(tx, context, "device.created", "device", id, imei);
    return { id, imei, currentSimId: null };
  }
  const holder = await repo.findDeviceByImei(tx, imei);
  if (!holder) throw refused("device.imei", NOT_AVAILABLE);
  return requireFreeDevice(tx, holder.id, "device.imei", scope);
}

async function requireFreeSim(tx: DbOrTx, id: string, field: string): Promise<TakenSim> {
  await repo.lockSims(tx, [id]);
  const sim = await repo.findSim(tx, id);
  if (!sim) throw refused(field, NOT_AVAILABLE);
  assertSimFree(sim, field);
  return sim;
}

export async function takeSim(tx: DbOrTx, context: ActivityContext, choice: SimChoice): Promise<TakenSim> {
  const { simId, iccid, msisdn = null, operatorId = null, planId = null } = choice;
  if (simId) return requireFreeSim(tx, simId, "sim.simId");
  if (!iccid) throw refused("sim.iccid", NOT_AVAILABLE);
  await assertSimReferences(tx, { operatorId, planId }, "sim.");
  const fields = { iccid, msisdn, operatorId, planId, note: null };
  const id = await repo.insertSim(tx, { ...fields, createdBy: actorIdOf(context) });
  if (id) {
    await recordRegistered(tx, context, "sim.created", "sim", id, iccid);
    return { id, iccid };
  }
  const holder = await repo.findSimByIccid(tx, iccid);
  if (!holder) throw await simConflict(tx, fields, "sim.");
  return requireFreeSim(tx, holder.id, "sim.iccid");
}

async function requireFreeSensor(tx: DbOrTx, id: string, field: string, scope: RecordScope): Promise<TakenSensor> {
  await repo.lockSensors(tx, [id]);
  const sensor = await repo.findSensor(tx, id);
  if (!sensor) throw refused(field, NOT_AVAILABLE);
  assertSensorFree(sensor, field, scope);
  return sensor;
}

export async function takeSensor(
  tx: DbOrTx,
  context: ActivityContext,
  scope: RecordScope,
  { sensorId, serialNo }: SensorChoice,
): Promise<TakenSensor> {
  if (sensorId) return requireFreeSensor(tx, sensorId, "sensor.sensorId", scope);
  if (!serialNo) throw refused("sensor.serialNo", NOT_AVAILABLE);
  const id = await repo.insertSensor(tx, { serialNo, note: null, createdBy: actorIdOf(context) });
  if (id) {
    await recordRegistered(tx, context, "sensor.created", "sensor", id, serialNo);
    return { id, serialNo };
  }
  const holder = await repo.findSensorBySerial(tx, serialNo);
  if (!holder) throw refused("sensor.serialNo", NOT_AVAILABLE);
  return requireFreeSensor(tx, holder.id, "sensor.serialNo", scope);
}

export async function requireContractor(tx: DbOrTx, id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  return (await requireActive(tx, "contractors", id, "contractorId", CONTRACTOR_TEXT)).name;
}

// The exclusion in the database has the last word: a date inside a past installation of the same tracker. Here it gets
// words, and a date before the last one too, which would overlap nothing yet leave the history out of order.
function assertAfter(last: installed.InstallationFact | null, validFrom: string, field: string): void {
  const end = last?.validTo ?? last?.validFrom;
  if (!end || validFrom >= end) return;
  const message = `Це обладнання вже стояло до ${dateText(end)}: дата встановлення має бути не раніше`;
  throw new AppError(409, "installation_date_overlap", message, { [field]: message });
}

export async function installDevice(
  tx: DbOrTx,
  objectId: string,
  deviceId: string,
  installation: Installation,
): Promise<void> {
  assertAfter(await installed.latestDeviceInstallation(tx, deviceId), installation.validFrom, "installedOn");
  assertAfter(await installed.latestInstallationOnObject(tx, objectId), installation.validFrom, "installedOn");
  await installed.openDeviceInstallation(tx, objectId, deviceId, installation);
}

export async function installSim(
  tx: DbOrTx,
  deviceId: string,
  simId: string,
  installation: Installation,
): Promise<void> {
  assertAfter(await installed.latestSimInstallation(tx, simId), installation.validFrom, "installedOn");
  assertAfter(await installed.latestInstallationInDevice(tx, deviceId), installation.validFrom, "installedOn");
  await installed.openSimInstallation(tx, deviceId, simId, installation);
}

export async function installSensor(
  tx: DbOrTx,
  objectId: string,
  sensorId: string,
  installation: Installation,
): Promise<void> {
  assertAfter(await installed.latestSensorInstallation(tx, sensorId), installation.validFrom, "installedOn");
  await installed.openSensorInstallation(tx, objectId, sensorId, installation);
}

export interface TrackerOff {
  deviceId: string;
  simId: string | null;
  validTo: string;
  state: "removed" | "repair";
  actorId: string | null;
}

// The SIM stays taken by the caller: it either goes into the next tracker or is let go. Its column first, so that the next
// tracker can hold it.
export async function takeTrackerOff(
  tx: DbOrTx,
  { deviceId, simId, validTo, state, actorId }: TrackerOff,
): Promise<void> {
  const open = await installed.latestDeviceInstallation(tx, deviceId);
  assertClosable(open, validTo);
  await installed.closeDeviceInstallations(tx, [deviceId], validTo);
  if (simId) await closeSimOf(tx, deviceId, validTo);
  await installed.markDevicesOff(tx, [deviceId], state, actorId);
}

async function closeSimOf(tx: DbOrTx, deviceId: string, validTo: string): Promise<void> {
  assertClosable(await installed.latestInstallationInDevice(tx, deviceId), validTo);
  await installed.closeSimInstallations(tx, [deviceId], validTo);
}

function assertClosable(open: installed.InstallationFact | null, validTo: string): void {
  if (!open || validTo >= open.validFrom) return;
  const message = `Поточне встановлення почалося ${dateText(open.validFrom)}: дата не може бути раніше`;
  throw new AppError(409, "installation_date_overlap", message, { installedOn: message });
}

export async function replaceSimOf(
  tx: DbOrTx,
  deviceId: string,
  oldSimId: string | null,
  validTo: string,
  actorId: string | null,
): Promise<void> {
  if (!oldSimId) return;
  await closeSimOf(tx, deviceId, validTo);
  await installed.clearCurrentSim(tx, deviceId, actorId);
  await installed.markSimsFree(tx, [oldSimId], actorId);
}

export function letSimGo(tx: DbOrTx, simId: string, actorId: string | null): Promise<void> {
  return installed.markSimsFree(tx, [simId], actorId);
}

export interface Tracker {
  imei: string;
  simId: string | null;
  iccid: string | null;
}

// Under the lock of the object and of the tracker: the SIM read here is the one that stands
export async function lockTracker(tx: DbOrTx, id: string): Promise<Tracker | null> {
  await repo.lockDevices(tx, [id]);
  const tracker = await repo.findTracker(tx, id);
  if (!tracker) return null;
  const { imei, currentSim } = tracker;
  if (currentSim) await repo.lockSims(tx, [currentSim.id]);
  return { imei, simId: currentSim?.id ?? null, iccid: currentSim?.iccid ?? null };
}

export async function removeSensor(
  tx: DbOrTx,
  objectId: string,
  sensorId: string,
  removedOn: string,
): Promise<boolean> {
  const open = await installed.findOpenSensorInstallation(tx, objectId, sensorId);
  if (!open) return false;
  assertClosable(open, removedOn);
  await installed.closeSensorInstallations(tx, { objectIds: [objectId], sensorId }, removedOn);
  return true;
}

interface ObjectEquipment {
  id: string;
  currentDeviceId: string | null;
}

// D71: an object going to the archive lets everything go on the same day. Set-based: a client goes with all its objects
export async function releaseEquipment(
  tx: DbOrTx,
  objects: ObjectEquipment[],
  today: string,
  actorId: string | null,
): Promise<void> {
  const deviceIds = objects.flatMap((object) => (object.currentDeviceId ? [object.currentDeviceId] : []));
  await repo.lockDevices(tx, deviceIds);
  const simIds = await installed.findCurrentSimIds(tx, deviceIds);
  await repo.lockSims(tx, simIds);
  await installed.closeDeviceInstallations(tx, deviceIds, today);
  await installed.closeSimInstallations(tx, deviceIds, today);
  await installed.closeSensorInstallations(tx, { objectIds: objects.map((object) => object.id) }, today);
  await installed.markDevicesOff(tx, deviceIds, "removed", actorId);
  await installed.markSimsFree(tx, simIds, actorId);
}

// objects.md П17
export async function discardEquipment(tx: DbOrTx, object: ObjectEquipment, actorId: string | null): Promise<void> {
  const deviceIds = object.currentDeviceId ? [object.currentDeviceId] : [];
  await repo.lockDevices(tx, deviceIds);
  const simIds = await installed.findCurrentSimIds(tx, deviceIds);
  await repo.lockSims(tx, simIds);
  await installed.deleteInstallationsOf(tx, object.id, deviceIds);
  await installed.markDevicesOff(tx, deviceIds, "removed", actorId);
  await installed.markSimsFree(tx, simIds, actorId);
}
