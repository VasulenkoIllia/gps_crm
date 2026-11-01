import type { Prisma } from "../../generated/prisma/client.js";
import type { DbClient, DbOrTx } from "../db/client.js";
import type { JobTrigger } from "./job.js";

// A monthly job keeps years of history in this, and a frequent one of step 4 keeps the last days instead of a growing table
const JOB_EVENTS_KEPT = 200;
export const ERROR_TEXT_MAX_LENGTH = 500;

export interface JobRunRecord {
  jobName: string;
  trigger: JobTrigger;
  startedAt: Date;
  finishedAt: Date;
}

// A row from the moment the job is registered, so a job that never ran still shows and turns red in time (П2)
export async function registerJobHealth(db: DbOrTx, name: string): Promise<void> {
  await db.jobHealth.upsert({ where: { name }, create: { name }, update: {} });
}

// Stays set when the process dies mid-run, which no catch sees: this is how the screen learns of it (system.md П2)
export async function markJobStarted(db: DbOrTx, name: string, startedAt: Date): Promise<void> {
  await db.jobHealth.update({ where: { name }, data: { runningSince: startedAt } });
}

async function addEvent(db: DbOrTx, data: Prisma.JobEventUncheckedCreateInput): Promise<void> {
  await db.jobEvent.create({ data });
}

async function trimEvents(db: DbOrTx, jobName: string): Promise<void> {
  await db.$executeRaw`
    DELETE FROM job_events
    WHERE job_name = ${jobName}
      AND id < (
        SELECT id FROM job_events WHERE job_name = ${jobName} ORDER BY id DESC OFFSET ${JOB_EVENTS_KEPT - 1} LIMIT 1
      )
  `;
}

export async function recordJobSuccess(
  db: DbClient,
  run: JobRunRecord,
  outcome: { skippedItems: number; summary?: Record<string, number> },
): Promise<void> {
  await db.$transaction(async (tx) => {
    await addEvent(tx, { ...run, isSuccess: true, skippedItems: outcome.skippedItems, summary: outcome.summary });
    await tx.jobHealth.update({
      where: { name: run.jobName },
      data: {
        runningSince: null,
        lastSuccessAt: run.finishedAt,
        failureStreak: 0,
        skippedItems: outcome.skippedItems,
        lastError: null,
      },
    });
    await trimEvents(tx, run.jobName);
  });
}

export async function recordJobFailure(db: DbClient, run: JobRunRecord, error: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await addEvent(tx, { ...run, isSuccess: false, error });
    await tx.jobHealth.update({
      where: { name: run.jobName },
      data: { runningSince: null, lastFailureAt: run.finishedAt, failureStreak: { increment: 1 }, lastError: error },
    });
    await trimEvents(tx, run.jobName);
  });
}
