import type { ActivityContext } from "../../core/activity/activity.repository.js";
import { actorIdOf, recordActivity } from "../../core/activity/activity.repository.js";
import type { DbClient, DbOrTx } from "../../core/db/client.js";
import { AppError } from "../../core/errors.js";
import * as queries from "./activity.queries.js";
import * as repo from "./activity.repository.js";

// A module that archives records registers how to bring them back. It may refuse with an AppError that says what stands
// in the way (activity.md §10). `tx` is the transaction of the restore: a failure brings the package back to the archive.
export type ArchiveRestorer = (tx: DbOrTx, batchId: string, context: ActivityContext) => Promise<void>;
export type ArchiveRestorers = Record<string, ArchiveRestorer>;

export const listActivity = queries.listActivity;
export const listActivityActors = queries.listActivityActors;
export const listArchive = queries.listArchive;

// The entry for a module's own transaction: it then marks its records with this id (activity.md П5). The package gets one
// line of the journal, and each record writes its own (§11).
export async function openArchiveBatch(
  tx: DbOrTx,
  context: ActivityContext,
  input: Omit<repo.ArchiveBatchInput, "archivedBy">,
): Promise<string> {
  const id = await repo.createArchiveBatch(tx, { ...input, archivedBy: actorIdOf(context) });
  await recordActivity(tx, context, {
    action: "record.archived",
    entityType: "archive_batch",
    entityId: id,
    details: { label: input.label, kind: input.entityType, itemCount: input.itemCount },
  });
  return id;
}

export async function restoreArchiveBatch(
  db: DbClient,
  restorers: ArchiveRestorers,
  context: ActivityContext,
  batchId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const batch = await repo.lockArchiveBatch(tx, batchId);
    if (!batch) throw new AppError(404, "not_found", "Пакет не знайдено");
    if (batch.isRestored) throw new AppError(409, "already_restored", "Цей пакет уже відновлено");
    const restore = restorers[batch.entityType];
    if (!restore) throw new AppError(409, "restore_unavailable", "Записи цього виду поки не можна відновити");
    await restore(tx, batch.id, context);
    await repo.markBatchRestored(tx, batch.id, actorIdOf(context));
    await recordActivity(tx, context, {
      action: "record.restored",
      // The package, not one of its records: the id here is the batch, and each record writes its own line (§11)
      entityType: "archive_batch",
      entityId: batch.id,
      details: { kind: batch.entityType, itemCount: batch.itemCount },
    });
  });
}
