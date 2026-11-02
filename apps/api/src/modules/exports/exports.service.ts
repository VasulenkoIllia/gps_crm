import type { Readable } from "node:stream";
import { EXPORT_ENTITIES, type ExportJob, type ExportRequest } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import { actorIdOf, recordActivity, type ActivityContext } from "../../core/activity/activity.repository.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { notFound } from "../references/index.js";
import { EXPORT_FAILED } from "./exports.build.js";
import { EXPORT_BUILD_TASK } from "./exports.jobs.js";
import * as repo from "./exports.repository.js";

// A list is read whole, and the queue takes two at a time: a double click or a script must not fill it for everyone
const OPEN_EXPORTS_MAX = 3;

// П1: the request only takes note, the job reads the list outside of it. The level of access goes along: the job reads
// what this person sees now.
export async function requestExport(
  deps: Pick<AppDeps, "db" | "jobs" | "logger">,
  context: ActivityContext,
  request: ExportRequest,
  scope: RecordScope,
): Promise<ExportJob> {
  const requestedBy = actorIdOf(context);
  if (!requestedBy) throw new Error("an export needs a person");
  const data = {
    requestedBy,
    entity: request.entity,
    params: { request, managerId: scope.managerId },
    ip: context.ip,
    requestId: context.requestId,
  };
  const row = await repo.createOpenExport(deps.db, data, OPEN_EXPORTS_MAX);
  if (!row) {
    throw new AppError(
      429,
      "exports_busy",
      `Уже готуються ${String(OPEN_EXPORTS_MAX)} файли. Дочекайтеся їх і спробуйте ще раз.`,
    );
  }
  // Not in one transaction with the row: pg-boss has its own connections. A row left without its job is failed here,
  // or by exports.cleanup if this does not get through either.
  try {
    await deps.jobs.enqueue(EXPORT_BUILD_TASK.name, { exportId: row.id });
  } catch (error) {
    deps.logger.error({ err: error, exportId: row.id }, "could not queue an export");
    await repo.failExport(deps.db, row.id, EXPORT_FAILED, new Date());
    throw new AppError(503, "export_unavailable", "Експорт зараз недоступний. Спробуйте за хвилину.");
  }
  return repo.toExportJob(row);
}

export async function readExport(deps: Pick<AppDeps, "db">, id: string, userId: string): Promise<ExportJob> {
  const row = await repo.findOwnExport(deps.db, id, userId);
  if (!row) throw notFound();
  return repo.toExportJob(row);
}

export interface ExportFile {
  name: string;
  mime: string;
  size: number;
  content: Readable;
}

// The download is a line of the journal too (06-quality.md §6.2.14)
export async function openExportFile(
  deps: Pick<AppDeps, "db" | "files" | "logger">,
  context: ActivityContext,
  id: string,
  userId: string,
  now = new Date(),
): Promise<ExportFile> {
  const row = await repo.findOwnExport(deps.db, id, userId);
  if (!row) throw notFound();
  const { file, status, expiresAt, entity } = row;
  if (status === "expired" || (expiresAt && expiresAt <= now)) {
    throw new AppError(410, "export_expired", "Файл уже видалено: він зберігається 24 години. Сформуйте новий.");
  }
  if (status !== "done" || !file) throw new AppError(409, "export_not_ready", "Файл ще не готовий");
  const content = await deps.files.openStream(file.key);
  if (!content) {
    deps.logger.error({ exportId: id }, "the file of an export is missing from the storage");
    throw new AppError(404, "file_missing", "Файл не знайдено у сховищі");
  }
  await recordActivity(deps.db, context, {
    action: "export.downloaded",
    entityType: "export",
    entityId: id,
    details: { label: file.originalName, list: EXPORT_ENTITIES[entity] },
  }).catch((error: unknown) => {
    content.destroy();
    throw error;
  });
  return { name: file.originalName, mime: file.mime, size: file.size, content };
}
