import type {
  DeviceCreate,
  DeviceStatus,
  DeviceUpdate,
  SensorCreate,
  SensorUpdate,
  SimCreate,
  SimStatus,
  SimUpdate,
} from "@gps_crm/shared";
import {
  actorIdOf,
  recordActivities,
  recordActivity,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import { isUniqueViolation, type DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import {
  assertVersion,
  changedFields,
  hasChanges,
  notFound,
  recordArchived,
  requireActive,
  type FieldChanges,
} from "../references/index.js";
import { findPlanOperator } from "./equipment.queries.js";
import * as repo from "./equipment.repository.js";

type EquipmentDeps = Pick<AppDeps, "db">;
export type EquipmentKind = repo.EquipmentKind;

const MODEL_TEXT = "Оберіть модель";
const OPERATOR_TEXT = "Оберіть оператора";
const PLAN_TEXT = "Оберіть тариф цього оператора";
const DEVICE_FIELDS = ["imei", "note", "ownership"] as const;
const SIM_FIELDS = ["iccid", "msisdn", "note"] as const;
const SENSOR_FIELDS = ["serialNo", "note"] as const;

function imeiTaken(holder: repo.DeviceRow | null): AppError {
  const message = holder?.archivedAt ? "Трекер з таким IMEI є в архіві: відновіть його" : "Трекер з таким IMEI уже є";
  return new AppError(409, "imei_taken", message, { imei: message });
}

function serialTaken(holder: repo.SensorRow | null): AppError {
  const message = holder?.archivedAt
    ? "Датчик з таким номером є в архіві: відновіть його"
    : "Датчик з таким номером уже є";
  return new AppError(409, "serial_taken", message, { serialNo: message });
}

// An insert or a write refused by a unique column: only the ICCID or the number can be behind it
export async function simConflict(tx: DbOrTx, { iccid }: { iccid: string }, prefix = ""): Promise<AppError> {
  const holder = await repo.findSimByIccid(tx, iccid);
  if (holder?.archivedAt) {
    const message = "SIM з таким ICCID є в архіві: відновіть її";
    return new AppError(409, "iccid_taken", message, { [`${prefix}iccid`]: message });
  }
  if (holder) {
    const message = "SIM з таким ICCID уже є";
    return new AppError(409, "iccid_taken", message, { [`${prefix}iccid`]: message });
  }
  const message = "Цей номер уже в іншої SIM";
  return new AppError(409, "msisdn_taken", message, { [`${prefix}msisdn`]: message });
}

export async function assertModel(tx: DbOrTx, id: string | null, field = "modelId"): Promise<string | null> {
  if (!id) return null;
  return (await requireActive(tx, "tracker-models", id, field, MODEL_TEXT)).name;
}

interface SimReferences {
  operatorId: string | null;
  planId: string | null;
}

// The foreign key on both columns refuses this too: here it gets the words of the module doc
export async function assertSimReferences(
  tx: DbOrTx,
  { operatorId, planId }: SimReferences,
  prefix = "",
): Promise<void> {
  if (operatorId) await requireActive(tx, "sim-operators", operatorId, `${prefix}operatorId`, OPERATOR_TEXT);
  if (!planId) return;
  await requireActive(tx, "sim-plans", planId, `${prefix}planId`, PLAN_TEXT);
  if ((await findPlanOperator(tx, planId)) !== operatorId) {
    throw new AppError(422, "plan_of_other_operator", PLAN_TEXT, { [`${prefix}planId`]: PLAN_TEXT });
  }
}

export async function registerDevice(
  deps: EquipmentDeps,
  context: ActivityContext,
  input: DeviceCreate,
): Promise<{ id: string }> {
  return deps.db.$transaction(async (tx) => {
    const { imei, modelId = null, ownership = null, note } = input;
    await assertModel(tx, modelId);
    const id = await repo.insertDevice(tx, { imei, modelId, ownership, note, createdBy: actorIdOf(context) });
    if (!id) throw imeiTaken(await repo.findDeviceByImei(tx, imei));
    await recordActivity(tx, context, {
      action: "device.created",
      entityType: "device",
      entityId: id,
      details: { label: imei },
    });
    return { id };
  });
}

export async function registerSim(
  deps: EquipmentDeps,
  context: ActivityContext,
  input: SimCreate,
): Promise<{ id: string }> {
  return deps.db.$transaction(async (tx) => {
    const { iccid, msisdn = null, operatorId = null, planId = null, note } = input;
    await assertSimReferences(tx, { operatorId, planId });
    const fields = { iccid, msisdn, operatorId, planId, note };
    const id = await repo.insertSim(tx, { ...fields, createdBy: actorIdOf(context) });
    if (!id) throw await simConflict(tx, fields);
    await recordActivity(tx, context, {
      action: "sim.created",
      entityType: "sim",
      entityId: id,
      details: { label: iccid },
    });
    return { id };
  });
}

export async function registerSensor(
  deps: EquipmentDeps,
  context: ActivityContext,
  input: SensorCreate,
): Promise<{ id: string }> {
  return deps.db.$transaction(async (tx) => {
    const { serialNo, note } = input;
    const id = await repo.insertSensor(tx, { serialNo, note, createdBy: actorIdOf(context) });
    if (!id) throw serialTaken(await repo.findSensorBySerial(tx, serialNo));
    await recordActivity(tx, context, {
      action: "sensor.created",
      entityType: "sensor",
      entityId: id,
      details: { label: serialNo },
    });
    return { id };
  });
}

function stateRefused(message: string): AppError {
  return new AppError(409, "state_refused", message, { status: message });
}

// equipment.md П4: `installed` follows the object, and a change here must not tell another story than its history
function assertDeviceState(before: repo.DeviceRow, status: DeviceStatus): void {
  if (before.object && status !== "installed") {
    throw stateRefused(`Трекер стоїть на об'єкті «${before.object.name}»: спершу замініть його там`);
  }
  if (!before.object && status === "installed")
    throw stateRefused("Стан «Встановлено» ставиться при встановленні на об'єкт");
}

function assertSimState(before: repo.SimRow, status: SimStatus): void {
  if (before.device && status === "free") throw stateRefused(`SIM стоїть у трекері ${before.device.imei}`);
  if (!before.device && status === "active") throw stateRefused("Активна лише SIM у трекері");
}

function stateEvent(
  entityType: "device" | "sim",
  entityId: string,
  label: string,
  status: [string, string],
): ActivityEventInput {
  return {
    action: entityType === "device" ? "device.state_changed" : "sim.state_changed",
    entityType,
    entityId,
    details: { label },
    changes: { status },
  };
}

function updatedEvent(
  action: ActivityEventInput["action"],
  entityType: string,
  entityId: string,
  label: string,
  changes: FieldChanges,
): ActivityEventInput {
  return { action, entityType, entityId, details: { label }, changes };
}

async function lockedDevice(tx: DbOrTx, id: string): Promise<repo.DeviceRow> {
  await repo.lockDevices(tx, [id]);
  const device = await repo.findDevice(tx, id);
  if (!device) throw notFound();
  if (device.archivedAt) throw recordArchived();
  return device;
}

async function lockedSim(tx: DbOrTx, id: string): Promise<repo.SimRow> {
  await repo.lockSims(tx, [id]);
  const sim = await repo.findSim(tx, id);
  if (!sim) throw notFound();
  if (sim.archivedAt) throw recordArchived();
  return sim;
}

async function modelChange(tx: DbOrTx, before: repo.DeviceRow, modelId: string | null): Promise<FieldChanges> {
  if (before.modelId === modelId) return {};
  return { model: [before.model?.name ?? null, await assertModel(tx, modelId)] };
}

export async function updateDevice(
  deps: EquipmentDeps,
  context: ActivityContext,
  id: string,
  input: DeviceUpdate,
): Promise<void> {
  await deps.db
    .$transaction(async (tx) => {
      const before = await lockedDevice(tx, id);
      assertVersion(before, input.version);
      assertDeviceState(before, input.status);
      const changes = {
        ...changedFields(before, input, [...DEVICE_FIELDS]),
        ...(await modelChange(tx, before, input.modelId)),
      };
      const isNewState = before.status !== input.status;
      if (!hasChanges(changes) && !isNewState) return;
      const { imei, modelId, ownership, status, note } = input;
      await repo.updateDevice(tx, id, { imei, modelId, ownership, status, note }, actorIdOf(context));
      await recordActivities(tx, context, [
        ...(hasChanges(changes) ? [updatedEvent("device.updated", "device", id, input.imei, changes)] : []),
        ...(isNewState ? [stateEvent("device", id, input.imei, [before.status, input.status])] : []),
      ]);
    })
    .catch(async (error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      throw imeiTaken(await repo.findDeviceByImei(deps.db, input.imei));
    });
}

function isSameSimReferences(before: repo.SimRow, input: SimUpdate): boolean {
  return before.operatorId === input.operatorId && before.planId === input.planId;
}

export async function updateSim(
  deps: EquipmentDeps,
  context: ActivityContext,
  id: string,
  input: SimUpdate,
): Promise<void> {
  await deps.db
    .$transaction(async (tx) => {
      const before = await lockedSim(tx, id);
      assertVersion(before, input.version);
      assertSimState(before, input.status);
      const sameReferences = isSameSimReferences(before, input);
      if (!sameReferences) await assertSimReferences(tx, input);
      const changes: FieldChanges = {
        ...changedFields(before, input, [...SIM_FIELDS]),
        ...(before.operatorId === input.operatorId
          ? {}
          : { operator: [before.operator?.name ?? null, input.operatorId] }),
        ...(before.planId === input.planId ? {} : { plan: [before.plan?.name ?? null, input.planId] }),
      };
      const isNewState = before.status !== input.status;
      if (!hasChanges(changes) && !isNewState) return;
      const { iccid, msisdn, operatorId, planId, status, note } = input;
      await repo.updateSim(tx, id, { iccid, msisdn, operatorId, planId, status, note }, actorIdOf(context));
      await recordActivities(tx, context, [
        ...(hasChanges(changes) ? [updatedEvent("sim.updated", "sim", id, input.iccid, changes)] : []),
        ...(isNewState ? [stateEvent("sim", id, input.iccid, [before.status, input.status])] : []),
      ]);
    })
    .catch(async (error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      throw await simConflict(deps.db, input);
    });
}

export async function updateSensor(
  deps: EquipmentDeps,
  context: ActivityContext,
  id: string,
  input: SensorUpdate,
): Promise<void> {
  await deps.db
    .$transaction(async (tx) => {
      await repo.lockSensors(tx, [id]);
      const before = await repo.findSensor(tx, id);
      if (!before) throw notFound();
      if (before.archivedAt) throw recordArchived();
      assertVersion(before, input.version);
      const changes = changedFields(before, input, [...SENSOR_FIELDS]);
      if (!hasChanges(changes)) return;
      await repo.updateSensor(tx, id, { serialNo: input.serialNo, note: input.note }, actorIdOf(context));
      await recordActivity(tx, context, updatedEvent("sensor.updated", "sensor", id, input.serialNo, changes));
    })
    .catch(async (error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      throw serialTaken(await repo.findSensorBySerial(deps.db, input.serialNo));
    });
}
