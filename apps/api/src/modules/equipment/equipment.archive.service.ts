import { ALL_RECORDS } from "../../core/access/access.js";
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
import { notFound, recordArchived } from "../references/index.js";
import { findBatchIdOf } from "./equipment.queries.js";
import * as repo from "./equipment.repository.js";

type EquipmentDeps = Pick<AppDeps, "db">;
type EquipmentKind = repo.EquipmentKind;

const KINDS = {
  device: { title: "Трекер", installedText: "Трекер стоїть на об'єкті: спершу замініть його там" },
  sim: { title: "SIM", installedText: "SIM стоїть у трекері: спершу замініть її на об'єкті" },
  sensor: { title: "Датчик", installedText: "Датчик стоїть на об'єкті: спершу зніміть його там" },
} as const;

interface EquipmentFacts {
  label: string;
  isArchived: boolean;
  isInstalled: boolean;
  snapshot: { id: string; note: string | null };
}

function snapshotOf<T extends { id: string; note: string | null }>({ id, note }: T, label: string) {
  return { id, note, number: label };
}

async function lockFacts(tx: DbOrTx, kind: EquipmentKind, id: string): Promise<EquipmentFacts> {
  if (kind === "device") {
    await repo.lockDevices(tx, [id]);
    const row = await repo.findDevice(tx, id);
    if (!row) throw notFound();
    const isInstalled = row.object !== null;
    return { label: row.imei, isArchived: row.archivedAt !== null, isInstalled, snapshot: snapshotOf(row, row.imei) };
  }
  if (kind === "sim") {
    await repo.lockSims(tx, [id]);
    const row = await repo.findSim(tx, id);
    if (!row) throw notFound();
    const isInstalled = row.device !== null;
    return { label: row.iccid, isArchived: row.archivedAt !== null, isInstalled, snapshot: snapshotOf(row, row.iccid) };
  }
  await repo.lockSensors(tx, [id]);
  const row = await repo.findSensor(tx, id);
  if (!row) throw notFound();
  const isInstalled = row.installations.length > 0;
  return {
    label: row.serialNo,
    isArchived: row.archivedAt !== null,
    isInstalled,
    snapshot: snapshotOf(row, row.serialNo),
  };
}

export async function archiveEquipment(
  deps: EquipmentDeps,
  context: ActivityContext,
  kind: EquipmentKind,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const { label, isArchived, isInstalled } = await lockFacts(tx, kind, id);
    if (isArchived) return;
    const { title, installedText } = KINDS[kind];
    if (isInstalled) throw new AppError(409, "equipment_installed", installedText);
    const batchId = await openArchiveBatch(tx, context, {
      entityType: kind,
      label: `${title}: ${label}`,
      itemCount: 1,
    });
    await repo.markArchived(tx, kind, id, batchId, actorIdOf(context));
    await recordActivity(tx, context, {
      action: `${kind}.archived`,
      entityType: kind,
      entityId: id,
      details: { label },
    });
  });
}

function restorerOf(kind: EquipmentKind): ArchiveRestorer {
  return async (tx, batchId, context) => {
    const rows = await repo.findBatchRows(tx, kind, batchId);
    await repo.clearBatch(tx, kind, batchId);
    await recordActivities(
      tx,
      context,
      rows.map(({ id, label }) => ({
        action: `${kind}.restored`,
        entityType: kind,
        entityId: id,
        details: { label },
      })),
    );
  };
}

export const EQUIPMENT_RESTORERS: ArchiveRestorers = {
  device: restorerOf("device"),
  sim: restorerOf("sim"),
  sensor: restorerOf("sensor"),
};

export async function restoreEquipment(
  deps: EquipmentDeps,
  context: ActivityContext,
  kind: EquipmentKind,
  id: string,
): Promise<void> {
  const batchId = await findBatchIdOf(deps.db, kind, id);
  if (batchId === undefined) throw notFound();
  if (batchId) await restoreArchiveBatch(deps.db, EQUIPMENT_RESTORERS, context, batchId, ALL_RECORDS);
}

// equipment.md П5: a record that has stood anywhere keeps its history, so it can only go to the archive
export async function deleteEquipment(
  deps: EquipmentDeps,
  context: ActivityContext,
  kind: EquipmentKind,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const { label, isArchived, snapshot } = await lockFacts(tx, kind, id);
    if (isArchived) throw recordArchived();
    if ((await repo.countInstallations(tx, kind, id)) > 0) {
      const message = "Цей запис уже стояв на об'єкті: його можна лише архівувати";
      throw new AppError(409, "equipment_has_history", message);
    }
    await repo.deleteRow(tx, kind, id);
    await recordActivity(tx, context, {
      action: `${kind}.deleted`,
      entityType: kind,
      entityId: id,
      details: { label },
      snapshot,
    });
  });
}
