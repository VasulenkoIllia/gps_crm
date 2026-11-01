import { isPrismaError } from "../logger.js";
import type { JobContext, JobDefinition, JobTrigger } from "./job.js";
import { ERROR_TEXT_MAX_LENGTH, markJobStarted, recordJobFailure, recordJobSuccess } from "./job.repository.js";

// What reaches the screen: a Prisma error repeats its query arguments, so only its kind and code (06-quality.md §6.2.14)
export function describeJobError(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown error";
  if (isPrismaError(error)) {
    const { code } = error as Error & { code?: string };
    return code ? `${error.name} ${code}` : error.name;
  }
  return `${error.name}: ${error.message}`.slice(0, ERROR_TEXT_MAX_LENGTH);
}

// The one way a job runs (system.md П1). The error goes on to pg-boss, which retries with a pause. A failure to record
// the failure is logged and does not replace it: pg-boss has to see the job's own error.
export async function runJob(definition: JobDefinition, context: JobContext, trigger: JobTrigger): Promise<void> {
  const { db, logger } = context;
  const startedAt = new Date();
  const run = { jobName: definition.name, trigger, startedAt };
  try {
    await markJobStarted(db, definition.name, startedAt);
    const outcome = await definition.run(context);
    const skippedItems = outcome.skippedItems ?? 0;
    await recordJobSuccess(db, { ...run, finishedAt: new Date() }, { skippedItems, summary: outcome.summary });
    logger.info({ job: definition.name, trigger, ...outcome }, "job finished");
  } catch (error) {
    logger.error({ err: error, job: definition.name, trigger }, "job failed");
    await recordJobFailure(db, { ...run, finishedAt: new Date() }, describeJobError(error)).catch((recordError) => {
      logger.error({ err: recordError, job: definition.name }, "could not record the job failure");
    });
    throw error;
  }
}
