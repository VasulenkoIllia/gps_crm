import type { AddSensor, RemoveSensor, ReplaceDevice, ReplaceSim } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivities,
  recordActivity,
  type ActivityContext,
} from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import {
  deviceIdOf,
  installDevice,
  installSensor,
  installSim,
  letSimGo,
  lockDevices,
  lockTracker,
  removeSensor,
  replaceSimOf,
  requireContractor,
  takeDevice,
  takeSensor,
  takeSim,
  takeTrackerOff,
  type Tracker,
} from "../equipment/index.js";
import { notFound } from "../references/index.js";
import { lockLiveObject, lockWorkingObject, objectDisconnected, objectEvent } from "./objects.helpers.js";
import * as repo from "./objects.repository.js";

type ObjectDeps = Pick<AppDeps, "db">;

const NO_SIM_TO_MOVE = "У трекері немає SIM: оберіть нову";
const NO_TRACKER = "На об'єкті немає трекера: спершу встановіть його";

// П8 with the one way out of D71: an object back from the archive has no tracker, and it gets one before it can reconnect
async function lockForReplacement(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.ObjectRow> {
  const object = await lockLiveObject(tx, id, scope);
  if (object.status === "disconnected" && object.currentDeviceId) throw objectDisconnected();
  return object;
}

async function lockOldTracker(tx: DbOrTx, deviceId: string | null): Promise<Tracker | null> {
  return deviceId ? lockTracker(tx, deviceId) : null;
}

export interface SimStep {
  simId: string;
  iccid: string;
  isMoved: boolean;
}

async function chooseSim(
  tx: DbOrTx,
  context: ActivityContext,
  old: Tracker | null,
  input: ReplaceDevice,
): Promise<SimStep> {
  if (input.sim) {
    const { id, iccid } = await takeSim(tx, context, input.sim);
    return { simId: id, iccid, isMoved: false };
  }
  if (!old?.simId || !old.iccid) throw new AppError(409, "no_sim_to_move", NO_SIM_TO_MOVE, { moveSim: NO_SIM_TO_MOVE });
  return { simId: old.simId, iccid: old.iccid, isMoved: true };
}

// П14, in one transaction: whatever fails, the object stays on its tracker. The status, the terms and the journal of the
// object do not change: only the object has the history, the tracker is what stood on it.
export async function replaceDevice(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ReplaceDevice,
): Promise<void> {
  const actorId = actorIdOf(context);
  await deps.db.$transaction(async (tx) => {
    const object = await lockForReplacement(tx, id, scope);
    const contractorId = input.contractorId ?? null;
    const contractor = await requireContractor(tx, contractorId);
    const oldId = object.currentDeviceId;
    const newId = await deviceIdOf(tx, input.device);
    await lockDevices(
      tx,
      [oldId, newId].flatMap((deviceId) => (deviceId ? [deviceId] : [])),
    );
    const old = await lockOldTracker(tx, oldId);
    const device = await takeDevice(tx, context, scope, input.device);
    const sim = await chooseSim(tx, context, old, input);
    const validFrom = input.installedOn;
    if (oldId) {
      const state = input.oldState;
      await takeTrackerOff(tx, { deviceId: oldId, simId: old?.simId ?? null, validTo: validFrom, state, actorId });
    }
    if (old?.simId && !sim.isMoved) await letSimGo(tx, old.simId, actorId);
    const installation = { validFrom, contractorId, actorId };
    await installDevice(tx, id, device.id, installation);
    await repo.setCurrentDevice(tx, id, device.id, actorId);
    await installSim(tx, device.id, sim.simId, installation);
    const where = { installedOn: validFrom, ...(contractor ? { contractor } : {}) };
    await recordActivities(tx, context, [
      objectEvent("device.replaced", object, {
        details: { ...where, ...(old ? { oldTrackerState: input.oldState } : {}) },
        changes: { imei: [old?.imei ?? null, device.imei] },
      }),
      ...(sim.isMoved
        ? []
        : [
            objectEvent("sim.replaced", object, {
              details: where,
              changes: { iccid: [old?.iccid ?? null, sim.iccid] },
            }),
          ]),
    ]);
  });
}

// equipment.md П7
export async function replaceSim(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ReplaceSim,
): Promise<void> {
  const actorId = actorIdOf(context);
  await deps.db.$transaction(async (tx) => {
    const object = await lockWorkingObject(tx, id, scope);
    const deviceId = object.currentDeviceId;
    const tracker = await lockOldTracker(tx, deviceId);
    if (!deviceId || !tracker) throw new AppError(409, "object_without_tracker", NO_TRACKER);
    const contractorId = input.contractorId ?? null;
    const contractor = await requireContractor(tx, contractorId);
    const sim = await takeSim(tx, context, input.sim);
    await replaceSimOf(tx, deviceId, tracker.simId, input.installedOn, actorId);
    await installSim(tx, deviceId, sim.id, { validFrom: input.installedOn, contractorId, actorId });
    await recordActivity(
      tx,
      context,
      objectEvent("sim.replaced", object, {
        details: { installedOn: input.installedOn, ...(contractor ? { contractor } : {}) },
        changes: { iccid: [tracker.iccid, sim.iccid] },
      }),
    );
  });
}

export async function addSensor(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: AddSensor,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const object = await lockWorkingObject(tx, id, scope);
    const contractorId = input.contractorId ?? null;
    const contractor = await requireContractor(tx, contractorId);
    const { installedOn } = input;
    const sensor = await takeSensor(tx, context, scope, input.sensor);
    await installSensor(tx, id, sensor.id, { validFrom: installedOn, contractorId, actorId: actorIdOf(context) });
    await recordActivity(
      tx,
      context,
      objectEvent("sensor.installed", object, {
        details: { serialNo: sensor.serialNo, installedOn, ...(contractor ? { contractor } : {}) },
      }),
    );
  });
}

export async function takeSensorOff(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  sensorId: string,
  { removedOn }: RemoveSensor,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const object = await lockWorkingObject(tx, id, scope);
    if (!(await removeSensor(tx, id, sensorId, removedOn))) throw notFound();
    await recordActivity(tx, context, objectEvent("sensor.removed", object, { details: { removedOn } }));
  });
}
