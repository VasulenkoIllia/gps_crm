import { todayKyiv } from "@gps_crm/shared";
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
  openArchiveBatch,
  restoreArchiveBatch,
  type ArchiveRestorer,
  type ArchiveRestorers,
} from "../activity/index.js";
import { releaseEquipment } from "../equipment/index.js";
import { notFound } from "../references/index.js";
import { lockSubscribers, refreshRollup, type ClientObjects } from "../subscribers/index.js";
import { lockObject, objectEvent } from "./objects.helpers.js";
import { findTariffFact, readArchiveState } from "./objects.queries.js";
import * as repo from "./objects.repository.js";

type ObjectDeps = Pick<AppDeps, "db">;

// П16. D71: the equipment leaves on this day, so a tracker never waits in the archive for an object that may not return
export async function archiveObject(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  const actorId = actorIdOf(context);
  await deps.db.$transaction(async (tx) => {
    const object = await lockObject(tx, id, scope);
    if (object.archivedAt) return;
    if (object.status !== "disconnected") {
      throw new AppError(409, "object_not_disconnected", "Архівувати можна лише відключений об'єкт");
    }
    const batchId = await openArchiveBatch(tx, context, {
      entityType: "object",
      label: `Об'єкт: ${object.name}`,
      itemCount: 1,
      subscriberId: object.subscriberId,
    });
    await releaseEquipment(tx, [{ id, currentDeviceId: object.currentDeviceId }], todayKyiv(), actorId);
    await repo.archiveObjects(tx, [id], batchId, actorId);
    await refreshRollup(tx, object.subscriberId);
    await recordActivity(tx, context, objectEvent("object.archived", object));
  });
}

function blocked(message: string): AppError {
  return new AppError(409, "restore_blocked", message);
}

// An object that went to the archive alone. With its client it comes back in the package of the client.
const restoreObjects: ArchiveRestorer = async (tx, batchId, context) => {
  const clients = [...new Set((await repo.findObjectsOfBatch(tx, batchId)).map((row) => row.subscriberId))];
  await lockSubscribers(tx, clients);
  const rows = await repo.findObjectsOfBatch(tx, batchId);
  for (const { subscriber } of rows) {
    if (subscriber.archivedAt) throw blocked(`Спершу відновіть клієнта «${subscriber.name}»`);
  }
  await repo.clearObjectBatch(tx, batchId);
  for (const subscriberId of clients) await refreshRollup(tx, subscriberId);
  await recordActivities(
    tx,
    context,
    rows.map((row) => objectEvent("object.restored", row)),
  );
};

export const OBJECT_RESTORERS: ArchiveRestorers = { object: restoreObjects };

export async function restoreObject(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  const state = await readArchiveState(deps.db, id, scope);
  if (!state) throw notFound();
  if (!state.batchId) return;
  if (state.clientName) throw blocked(`Спершу відновіть клієнта «${state.clientName}»`);
  await restoreArchiveBatch(deps.db, OBJECT_RESTORERS, context, state.batchId, scope);
}

async function followClientTariff(
  tx: DbOrTx,
  subscriberId: string,
  tariff: { id: string },
  actorId: string | null,
): Promise<void> {
  const { tariffId, programId, serverId } = await findTariffFact(tx, tariff.id);
  await repo.followTariff(tx, subscriberId, { tariffId, programId, serverId }, actorId);
}

// Only disconnected ones are left at this point: the client refuses to go with any other
async function archiveWithClient(
  tx: DbOrTx,
  subscriberId: string,
  batchId: string,
  actorId: string | null,
): Promise<{ id: string; label: string }[]> {
  const rows = await repo.findLiveObjectsOf(tx, subscriberId);
  await releaseEquipment(tx, rows, todayKyiv(), actorId);
  await repo.archiveObjects(
    tx,
    rows.map((row) => row.id),
    batchId,
    actorId,
  );
  return rows.map((row) => ({ id: row.id, label: row.name }));
}

async function restoreWithClient(tx: DbOrTx, batchId: string) {
  const rows = await repo.findObjectsOfBatch(tx, batchId);
  await repo.clearObjectBatch(tx, batchId);
  return rows.map((row) => ({ id: row.id, label: row.name, subscriberId: row.subscriberId }));
}

export const CLIENT_OBJECTS: ClientObjects = { followClientTariff, archiveWithClient, restoreWithClient };
