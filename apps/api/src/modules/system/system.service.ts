import { statfs } from "node:fs/promises";
import type { JobList, JobRun, SystemStatus } from "@gps_crm/shared";
import { recordActivity, SYSTEM_ACTOR, type ActivityContext } from "../../core/activity/activity.repository.js";
import type { DbClient } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import type { JobDefinition, JobQueue, QueueStat } from "../../core/jobs/job.js";
import { readBackupFiles } from "./backup-files.js";
import { backupStatus, diskVerdict, jobVerdict, queueVerdict } from "./system.health.js";
import {
  readDatabaseSize,
  readDeployments,
  readJobHealth,
  readRecentJobRuns,
  type JobRunRow,
} from "./system.queries.js";

const ROOT_PATH = "/";
const PERCENT = 100;

async function readDisk(path: string, logger: AppDeps["logger"]): Promise<SystemStatus["disk"]> {
  try {
    const { bsize, blocks, bfree, bavail } = await statfs(path);
    const used = blocks - bfree;
    // Like df: blocks reserved for root are not room the app can use
    const usable = used + bavail;
    const usedPercent = usable > 0 ? Math.round((used / usable) * PERCENT) : null;
    return { ...diskVerdict(usedPercent), usedPercent, freeBytes: bavail * bsize, totalBytes: usable * bsize };
  } catch (error) {
    // A question of the screen, not of the app: it stays yellow with that word on it
    logger.warn({ err: error, path }, "could not read the disk");
    return { ...diskVerdict(null), usedPercent: null, freeBytes: null, totalBytes: null };
  }
}

function withLabels(queues: QueueStat[], definitions: JobDefinition[]): SystemStatus["queues"] {
  const titles = new Map(definitions.map(({ name, title }) => [name, title]));
  return queues.map((queue) => ({ ...queue, label: titles.get(queue.name) ?? queue.name }));
}

// A queue the worker has not made yet throws, and that must not take the backups and the disk off the screen with it
async function readQueueStats(jobs: JobQueue, logger: AppDeps["logger"]): Promise<QueueStat[] | null> {
  try {
    return await jobs.readQueues();
  } catch (error) {
    logger.error({ err: error }, "could not read the job queues");
    return null;
  }
}

export async function readSystemStatus(deps: AppDeps): Promise<SystemStatus> {
  const { db, config, jobs, logger } = deps;
  const now = new Date();
  const [backupFiles, queues, database, disk, deployments] = await Promise.all([
    readBackupFiles(config.backupStatusDir, logger),
    readQueueStats(jobs, logger),
    readDatabaseSize(db),
    readDisk(config.backupStatusDir ?? ROOT_PATH, logger),
    readDeployments(db),
  ]);
  return {
    checkedAt: now.toISOString(),
    backups: backupStatus(backupFiles.dump, backupFiles.check, now),
    queueState: queueVerdict(queues !== null, jobs.lastErrorAt(), now),
    queues: withLabels(queues ?? [], jobs.definitions),
    database,
    disk,
    version: { current: config.appVersion, deployments },
  };
}

function toJobRun(run: JobRunRow): JobRun {
  return {
    id: run.id,
    trigger: run.trigger,
    isSuccess: run.isSuccess,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt.toISOString(),
    skippedItems: run.skippedItems,
    error: run.error,
  };
}

export async function listJobs(deps: AppDeps): Promise<JobList> {
  const now = new Date();
  const [healthRows, runRows] = await Promise.all([readJobHealth(deps.db), readRecentJobRuns(deps.db)]);
  const health = new Map(healthRows.map((row) => [row.name, row]));
  return {
    items: deps.jobs.definitions.map((definition) => {
      const row = health.get(definition.name) ?? null;
      return {
        ...jobVerdict(row, definition.maxSilenceMs, now),
        name: definition.name,
        title: definition.title,
        scheduleLabel: definition.scheduleLabel,
        canRunByHand: definition.canRunByHand,
        lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
        failureStreak: row?.failureStreak ?? 0,
        skippedItems: row?.skippedItems ?? 0,
        lastError: row?.lastError ?? null,
        runs: runRows.filter((run) => run.jobName === definition.name).map(toJobRun),
      };
    }),
  };
}

export async function runJobByHand(deps: AppDeps, context: ActivityContext, name: string): Promise<void> {
  const definition = deps.jobs.definitions.find((job) => job.name === name);
  if (!definition) throw new AppError(404, "not_found", "Задачу не знайдено");
  if (!definition.canRunByHand) throw new AppError(409, "manual_run_forbidden", "Цю задачу не можна запускати вручну");
  const request = await deps.jobs.requestRun(name);
  if (request === "busy") throw new AppError(409, "job_busy", "Задача вже виконується або стоїть у черзі");
  await recordActivity(deps.db, context, {
    action: "job.run_requested",
    entityType: "job",
    details: { job: definition.title },
  });
}

// Once per version, from the app that runs it: this also covers a rollback, which skips the deploy's migrate step. The
// server knows a deploy key and no person, so the journal says «система» (system.md П5).
export async function noteDeployment(db: DbClient, version: string): Promise<boolean> {
  const [latest] = await readDeployments(db);
  const previousVersion = latest?.version ?? null;
  if (previousVersion === version) return false;
  await recordActivity(
    db,
    { actor: SYSTEM_ACTOR, ip: null, requestId: null },
    { action: "system.deployed", details: { version, previousVersion } },
  );
  return true;
}
