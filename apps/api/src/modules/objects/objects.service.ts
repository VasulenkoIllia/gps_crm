import type { CreatedObject, ObjectCreate, ObjectUpdate } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivities,
  recordActivity,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import {
  discardEquipment,
  installDevice,
  installSensor,
  installSim,
  requireContractor,
  takeDevice,
  takeSensor,
  takeSim,
} from "../equipment/index.js";
import {
  assertVersion,
  changedFields,
  hasChanges,
  recordArchived,
  requireActive,
  selectTariff,
} from "../references/index.js";
import { refreshRollup, requireClientPayer, requireLiveSubscriber } from "../subscribers/index.js";
import { lockObject, lockWorkingObject, objectEvent } from "./objects.helpers.js";
import { findTariffFact, isAddonOfProgram, type TariffFact } from "./objects.queries.js";
import * as repo from "./objects.repository.js";

type ObjectDeps = Pick<AppDeps, "db">;

// One object may bring a new tracker, a new SIM, sensors and the lock on a client that others are writing to
const CREATE_TRANSACTION = { maxWait: 10_000, timeout: 10_000 };
const REASON_TEXT = "Вкажіть причину відключення";
const ADDON_TEXT = "Оберіть послугу";
const UPDATED_FIELDS = ["name", "note"] as const;

function tariffText(tariff: Pick<TariffFact, "tariffName" | "serverName">): string {
  return `${tariff.tariffName} (${tariff.serverName})`;
}

// П24: the addon itself is checked against the program the object will stand in
export async function requireAddonOfProgram(
  tx: DbOrTx,
  addonId: string,
  program: Pick<TariffFact, "programId" | "programName">,
  field: string,
): Promise<string> {
  const { name } = await requireActive(tx, "addons", addonId, field, ADDON_TEXT);
  if (await isAddonOfProgram(tx, addonId, program.programId)) return name;
  const message = `Ця послуга недоступна для програми ${program.programName}`;
  throw new AppError(422, "addon_unavailable", message, { [field]: message });
}

interface ObjectTerms {
  tariff: TariffFact;
  versions: repo.NewTerm[];
}

// П18: a tariff of its own, from its date. Before that date the object stands on the tariff of the client.
async function firstTerms(
  tx: DbOrTx,
  input: ObjectCreate,
  clientTariffId: string,
  createdBy: string | null,
): Promise<ObjectTerms> {
  const { payerId, connectedOn, ownTariff } = input;
  const base = { payerId, createdBy };
  if (!ownTariff) {
    const tariff = await findTariffFact(tx, clientTariffId);
    return { tariff, versions: [{ ...base, ownTariffId: null, validFrom: connectedOn, validTo: null }] };
  }
  await selectTariff(tx, ownTariff.programId, ownTariff.tariffId);
  const tariff = await findTariffFact(tx, ownTariff.tariffId);
  const own = { ...base, ownTariffId: ownTariff.tariffId, validTo: null };
  if (ownTariff.validFrom <= connectedOn) return { tariff, versions: [{ ...own, validFrom: connectedOn }] };
  return {
    tariff,
    versions: [
      { ...base, ownTariffId: null, validFrom: connectedOn, validTo: ownTariff.validFrom },
      { ...own, validFrom: ownTariff.validFrom },
    ],
  };
}

async function addAddons(
  tx: DbOrTx,
  id: string,
  input: ObjectCreate,
  tariff: TariffFact,
  actorId: string | null,
): Promise<string[]> {
  const names: string[] = [];
  for (const { addonId, validFrom } of input.addons) {
    names.push(await requireAddonOfProgram(tx, addonId, tariff, "addons"));
    await repo.openAddon(tx, id, addonId, validFrom, actorId);
  }
  return names;
}

interface CreatedParts {
  object: { id: string; name: string; subscriberId: string };
  tariff: TariffFact;
  payerName: string;
  addons: string[];
  equipment: ActivityEventInput[];
}

function recordCreated(
  tx: DbOrTx,
  context: ActivityContext,
  input: ObjectCreate,
  { object, tariff, payerName, addons, equipment }: CreatedParts,
) {
  const details = {
    status: input.status,
    statusFrom: input.statusFrom,
    connectedOn: input.connectedOn,
    tariff: tariffText(tariff),
    payer: payerName,
    ...(addons.length > 0 ? { addon: addons.join(", ") } : {}),
  };
  return recordActivities(tx, context, [objectEvent("object.created", object, { details }), ...equipment]);
}

async function installEverything(
  tx: DbOrTx,
  context: ActivityContext,
  scope: RecordScope,
  input: ObjectCreate,
  object: CreatedParts["object"],
  taken: { deviceId: string; imei: string; simId: string; iccid: string },
): Promise<ActivityEventInput[]> {
  const contractor = await requireContractor(tx, input.contractorId);
  const contractorId = input.contractorId ?? null;
  const actorId = actorIdOf(context);
  const installation = { validFrom: input.installedOn, contractorId, actorId };
  const where = { installedOn: input.installedOn, ...(contractor ? { contractor } : {}) };
  await installDevice(tx, object.id, taken.deviceId, installation);
  await installSim(tx, taken.deviceId, taken.simId, installation);
  const events = [
    objectEvent("device.installed", object, { details: { imei: taken.imei, ...where } }),
    objectEvent("sim.installed", object, { details: { iccid: taken.iccid, ...where } }),
  ];
  for (const { sensor, installedOn } of input.sensors) {
    const { id, serialNo } = await takeSensor(tx, context, scope, sensor);
    await installSensor(tx, object.id, id, { ...installation, validFrom: installedOn });
    events.push(objectEvent("sensor.installed", object, { details: { serialNo, installedOn } }));
  }
  return events;
}

export function createObject(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  input: ObjectCreate,
): Promise<CreatedObject> {
  const actorId = actorIdOf(context);
  return deps.db.$transaction(async (tx) => {
    const { subscriberId, name, status, statusFrom, connectedOn, payerId, note } = input;
    const subscriber = await requireLiveSubscriber(tx, subscriberId, scope);
    const payer = await requireClientPayer(tx, subscriberId, payerId);
    const reasonId = input.disconnectReasonId ?? null;
    if (reasonId) await requireActive(tx, "disconnect-reasons", reasonId, "disconnectReasonId", REASON_TEXT);
    const { tariff, versions } = await firstTerms(tx, input, subscriber.tariffId, actorId);
    const device = await takeDevice(tx, context, scope, input.device);
    const sim = await takeSim(tx, context, input.sim);
    const id = await repo.insertObject(tx, {
      subscriberId,
      name,
      status,
      statusFrom,
      connectedOn,
      disconnectReasonId: reasonId,
      payerId,
      tariff,
      hasOwnTariff: Boolean(input.ownTariff),
      currentDeviceId: device.id,
      note,
      createdBy: actorId,
    });
    await repo.openStatusPeriod(tx, id, { status, validFrom: statusFrom, reasonId, note: null, createdBy: actorId });
    for (const version of versions) await repo.openTerm(tx, id, version);
    const addons = await addAddons(tx, id, input, tariff, actorId);
    const object = { id, name, subscriberId };
    const taken = { deviceId: device.id, imei: device.imei, simId: sim.id, iccid: sim.iccid };
    const equipment = await installEverything(tx, context, scope, input, object, taken);
    await refreshRollup(tx, subscriberId);
    await recordCreated(tx, context, input, { object, tariff, payerName: payer.name, addons, equipment });
    return { id };
  }, CREATE_TRANSACTION);
}

export async function updateObject(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ObjectUpdate,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const before = await lockWorkingObject(tx, id, scope);
    assertVersion(before, input.version);
    const changes = changedFields(before, input, [...UPDATED_FIELDS]);
    if (!hasChanges(changes)) return;
    await repo.updateObject(tx, id, { name: input.name, note: input.note }, actorIdOf(context));
    const object = { id, name: input.name, subscriberId: before.subscriberId };
    await recordActivity(tx, context, objectEvent("object.updated", object, { changes }));
  });
}

// П17: a mistake undone. What it let on stays in the journal, and the equipment comes off as if it never went on.
export async function deleteObject(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const object = await lockObject(tx, id, scope);
    if (object.archivedAt) throw recordArchived();
    const { statuses, devices, sims, closedSensors } = await repo.countHistory(tx, object);
    if (statuses > 1 || devices > 1 || sims > 1 || closedSensors > 0 || !object.currentDeviceId) {
      throw new AppError(409, "object_has_history", "Об'єкт уже має історію: його можна лише архівувати");
    }
    await discardEquipment(tx, object, actorIdOf(context));
    await repo.deleteObjectRows(tx, id);
    await refreshRollup(tx, object.subscriberId);
    const { name, status, statusFrom, connectedOn, payerId, tariffId, note } = object;
    const snapshot = { name, status, statusFrom, connectedOn, payerId, tariffId, note };
    await recordActivity(tx, context, objectEvent("object.deleted", object, { snapshot }));
  });
}
