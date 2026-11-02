import type { ExportJob as ExportJobDto } from "@gps_crm/shared";
import type { DbClient, DbOrTx } from "../../core/db/client.js";
import type { ExportEntity, Prisma } from "../../generated/prisma/client.js";

const OPEN_STATUSES = ["queued", "running"] as const;
// The space of two-number advisory locks, which no other lock of the app uses: the second number is the person
const EXPORTS_LOCK_SPACE = 6;

const DTO_ROW = {
  id: true,
  entity: true,
  status: true,
  rowCount: true,
  error: true,
  createdAt: true,
  finishedAt: true,
  expiresAt: true,
} satisfies Prisma.ExportJobSelect;

type DtoRow = Prisma.ExportJobGetPayload<{ select: typeof DTO_ROW }>;

export function toExportJob(row: DtoRow): ExportJobDto {
  const { id, entity, status, rowCount, error } = row;
  return {
    id,
    entity,
    status,
    rowCount,
    error,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

export interface NewExport {
  requestedBy: string;
  entity: ExportEntity;
  params: Prisma.InputJsonValue;
  ip: string | null;
  requestId: string | null;
}

// Null: the person has `openMax` exports not finished yet. The count and the new row under one lock of the person, so
// requests sent together do not pass the limit together.
export function createOpenExport(db: DbClient, data: NewExport, openMax: number): Promise<DtoRow | null> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EXPORTS_LOCK_SPACE}::int, hashtext(${data.requestedBy}))`;
    const open = await tx.exportJob.count({
      where: { requestedBy: data.requestedBy, status: { in: [...OPEN_STATUSES] } },
    });
    return open < openMax ? tx.exportJob.create({ data, select: DTO_ROW }) : null;
  });
}

// Someone else's export does not exist for this person
export function findOwnExport(db: DbOrTx, id: string, userId: string) {
  return db.exportJob.findFirst({
    where: { id, requestedBy: userId },
    select: { ...DTO_ROW, file: { select: { key: true, originalName: true, mime: true, size: true } } },
  });
}

// Takes the export for this run. Null: it is finished already, and a repeat of the job has nothing to do.
export async function startExport(db: DbOrTx, id: string, now: Date) {
  const { count } = await db.exportJob.updateMany({
    where: { id, status: { in: [...OPEN_STATUSES] } },
    data: { status: "running", startedAt: now },
  });
  if (count === 0) return null;
  return db.exportJob.findUniqueOrThrow({
    where: { id },
    select: { id: true, entity: true, params: true, requestedBy: true, ip: true, requestId: true },
  });
}

// Only a running one. False: another attempt finished it, or exports.cleanup gave up on it, and this file is extra.
export async function completeExport(
  db: DbOrTx,
  id: string,
  result: { fileId: string; rowCount: number; finishedAt: Date; expiresAt: Date },
): Promise<boolean> {
  const { count } = await db.exportJob.updateMany({
    where: { id, status: "running" },
    data: { status: "done", ...result },
  });
  return count === 1;
}

// Only an open one: a run that lost the race to a finished one must not take its file away. True: this call failed it.
export async function failExport(db: DbOrTx, id: string, error: string, now: Date): Promise<boolean> {
  const { count } = await db.exportJob.updateMany({
    where: { id, status: { in: [...OPEN_STATUSES] } },
    data: { status: "failed", error, finishedAt: now },
  });
  return count === 1;
}

export function findExpiredExports(db: DbOrTx, now: Date, take: number) {
  return db.exportJob.findMany({
    where: { status: "done", expiresAt: { lte: now } },
    orderBy: { expiresAt: "asc" },
    take,
    select: { id: true, fileId: true },
  });
}

export async function expireExport(db: DbOrTx, id: string): Promise<void> {
  await db.exportJob.updateMany({ where: { id, status: "done" }, data: { status: "expired", fileId: null } });
}

// What no run will finish any more: the process died on the last attempt, or the queue lost the job. The ids, so the
// files the runs left can go too.
export async function failStaleExports(db: DbOrTx, before: Date, error: string, now: Date): Promise<string[]> {
  const rows = await db.exportJob.updateManyAndReturn({
    where: { status: { in: [...OPEN_STATUSES] }, createdAt: { lt: before } },
    data: { status: "failed", error, finishedAt: now },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
