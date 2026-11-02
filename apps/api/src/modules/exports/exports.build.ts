import { PassThrough } from "node:stream";
import { dateText, EXPORT_ENTITIES, EXPORT_FILE_HOURS, exportRequestSchema, todayKyiv } from "@gps_crm/shared";
import { z } from "zod";
import { recordActivity, type ActivityContext } from "../../core/activity/activity.repository.js";
import { createFileRecord, deleteFileRecord, placeFileStream } from "../../core/files/files.repository.js";
import type { JobContext, JobOutcome, TaskContext } from "../../core/jobs/job.js";
import { describeFilters, referencedIds } from "./exports.filters.js";
import { readFilterNames } from "./exports.queries.js";
import * as repo from "./exports.repository.js";
import { exportSheet } from "./exports.sheet.js";
import { ExportRefused, writeWorkbook } from "./exports.workbook.js";

const EXPORT_OWNER = "export";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const HOUR_MS = 3_600_000;
export const EXPORT_FAILED = "Не вдалося сформувати файл. Спробуйте ще раз.";
// Two attempts of 30 minutes and the pause between them: past this no run of the export is alive
const STALE_AFTER_MS = 2 * HOUR_MS;
const CLEANUP_BATCH = 100;

const taskDataSchema = z.strictObject({ exportId: z.uuid() });
// What the request stored: the parsed request and the level of access of that moment (exports.service.ts)
const paramsSchema = z.strictObject({ request: exportRequestSchema, managerId: z.uuid().nullable() });

// Every attempt of an export writes under the folder of the export: what a killed run left goes away with it
const folderOf = (exportId: string) => `${EXPORT_OWNER}/${exportId}`;

// Another attempt finished the export first, or exports.cleanup gave up on it: this run's file is extra, and no failure
class FinishedElsewhere extends Error {}

function exportFileName(entity: keyof typeof EXPORT_ENTITIES, at: Date): string {
  return `${EXPORT_ENTITIES[entity]} ${dateText(todayKyiv(at))}.xlsx`;
}

type StartedExport = NonNullable<Awaited<ReturnType<typeof repo.startExport>>>;

// The person who asked: the line of the journal is theirs, from where they asked it (П4)
function requesterOf(job: StartedExport): ActivityContext {
  return { actor: { kind: "user", id: job.requestedBy }, ip: job.ip, requestId: job.requestId };
}

async function writeExport({ db, files, signal }: TaskContext, job: StartedExport): Promise<void> {
  const { request, managerId } = paramsSchema.parse(job.params);
  const out = new PassThrough();
  const placing = placeFileStream(files, folderOf(job.id), out);
  // A full disk fails the storage: the workbook stops with it instead of waiting for a reader that is gone
  const storageFailed = new AbortController();
  placing.done.catch((error: unknown) => storageFailed.abort(error));
  try {
    const sheet = exportSheet(db, request, { managerId });
    const rowCount = await writeWorkbook(out, sheet, AbortSignal.any([signal, storageFailed.signal]));
    const placed = await placing.done;
    const finishedAt = new Date();
    const fileName = exportFileName(request.entity, finishedAt);
    const filters = describeFilters(request, await readFilterNames(db, referencedIds(request)));
    await db.$transaction(async (tx) => {
      const file = { ownerType: EXPORT_OWNER, ownerId: job.id, originalName: fileName, mime: XLSX_MIME };
      const fileId = await createFileRecord(tx, files, file, placed, job.requestedBy);
      const expiresAt = new Date(finishedAt.getTime() + EXPORT_FILE_HOURS * HOUR_MS);
      if (!(await repo.completeExport(tx, job.id, { fileId, rowCount, finishedAt, expiresAt }))) {
        throw new FinishedElsewhere();
      }
      await recordActivity(tx, requesterOf(job), {
        action: "export.completed",
        entityType: "export",
        entityId: job.id,
        details: { label: fileName, list: EXPORT_ENTITIES[request.entity], rowCount, filters },
      });
    });
  } catch (error) {
    // Whatever part of the file is there: a destroyed source ends its writing, and then the file can go
    out.destroy(error instanceof Error ? error : new Error(String(error)));
    await placing.done.catch(() => undefined);
    await files.remove(placing.key);
    throw error;
  }
}

// The folder only when this run failed the export: another attempt may have finished it, and its file is in there
async function giveUp({ db, files, logger }: TaskContext, exportId: string, message: string): Promise<void> {
  if (!(await repo.failExport(db, exportId, message, new Date()))) return;
  // The row says «failed» already and no sweep comes back to it: a file left here only costs disk
  await files.removeFolder(folderOf(exportId)).catch((error: unknown) => {
    logger.warn({ err: error, exportId }, "could not remove the files of a failed export");
  });
}

// The task exports.build (search-exports.md П1). Safe to repeat: a finished export is not taken again.
export async function buildExport(context: TaskContext, data: unknown): Promise<void> {
  const { logger, isLastAttempt } = context;
  // Data no request of this app writes: there is no export to fail, and pg-boss keeps the error
  const { exportId } = taskDataSchema.parse(data);
  try {
    const job = await repo.startExport(context.db, exportId, new Date());
    if (job) await writeExport(context, job);
  } catch (error) {
    if (error instanceof FinishedElsewhere) {
      logger.warn({ exportId }, "an export was finished elsewhere meanwhile, the file of this run is removed");
      return;
    }
    if (error instanceof ExportRefused) {
      await giveUp(context, exportId, error.message);
      return;
    }
    logger.error({ err: error, exportId }, "export failed");
    if (isLastAttempt) await giveUp(context, exportId, EXPORT_FAILED);
    throw error;
  }
}

// The files first: an expired row keeps no key, and a file it lost track of would stay for good
async function expire({ db, files }: JobContext, job: { id: string; fileId: string | null }): Promise<void> {
  await files.removeFolder(folderOf(job.id));
  await db.$transaction(async (tx) => {
    await repo.expireExport(tx, job.id);
    if (job.fileId) await deleteFileRecord(tx, job.fileId);
  });
}

// The job exports.cleanup: a file lives 24 hours (П1), and an export no run will finish turns into a failure. One that
// fails to go stays for the next hour and shows on the screen as skipped.
export async function cleanUpExports(context: JobContext, now = new Date()): Promise<JobOutcome> {
  const { db, files, logger } = context;
  let expired = 0;
  // A row that fails comes back in the next batch of the same run: it counts once
  const skipped = new Set<string>();
  for (;;) {
    const batch = await repo.findExpiredExports(db, now, CLEANUP_BATCH);
    let expiredNow = 0;
    for (const job of batch.filter(({ id }) => !skipped.has(id))) {
      try {
        await expire(context, job);
        expiredNow += 1;
      } catch (error) {
        logger.warn({ err: error, exportId: job.id }, "could not remove an expired export");
        skipped.add(job.id);
      }
    }
    expired += expiredNow;
    // A batch of nothing but failures would come back the same
    if (batch.length < CLEANUP_BATCH || expiredNow === 0) break;
  }
  let skippedItems = skipped.size;
  const stale = await repo.failStaleExports(db, new Date(now.getTime() - STALE_AFTER_MS), EXPORT_FAILED, now);
  // The rows first, as in giveUp: a run that finishes in between keeps its file. A folder that stays only costs disk.
  for (const exportId of stale) {
    await files.removeFolder(folderOf(exportId)).catch((error: unknown) => {
      logger.warn({ err: error, exportId }, "could not remove the files of a stale export");
      skippedItems += 1;
    });
  }
  return { skippedItems, summary: { expired, failed: stale.length } };
}
