import type { Logger } from "pino";
import type { DbClient } from "../db/client.js";
import type { FileStorage } from "../files/file-storage.js";

export type JobTrigger = "schedule" | "manual";

// After this pg-boss fails the run and retries it, so a run lost to a crash comes back. Above the worker's 5 minute
// statement, and it does not stop a handler that is still going: one that hangs turns red instead (system.md §11).
export const JOB_EXPIRE_SECONDS = 1_800;

export interface JobContext {
  // The worker's profile: long statements are fine here, unlike on the pool of the requests
  db: DbClient;
  logger: Pick<Logger, "info" | "warn" | "error">;
  files: FileStorage;
}

export interface JobOutcome {
  // Elements a batch had to leave out: the run still counts as a success, and the screen shows the number
  skippedItems?: number;
  summary?: Record<string, number>;
}

// A job is safe to repeat (06-quality.md §6.3): pg-boss retries it, and a person may press the button
export interface JobDefinition {
  name: string;
  title: string;
  // What it does and when a person runs it by hand, in the words of the screen «Система» (D89)
  description: string;
  // In Europe/Kyiv, clear of the clock change at 03:00-04:59 (03-data-model.md §3.1)
  cron: string;
  scheduleLabel: string;
  // How long a job may stay without a success before it turns red: its schedule with a margin (system.md П2)
  maxSilenceMs: number;
  canRunByHand: boolean;
  run: (context: JobContext) => Promise<JobOutcome>;
}

// A job a request asks for, with data of its own, as often as people ask: no schedule and no row on the list of jobs of
// «Система», which shows its queue instead (system.md П6)
export interface TaskContext extends JobContext {
  // Fires when pg-boss gives up on the run: a long task stops between its batches
  signal: AbortSignal;
  // No retry follows a failure of this run, so the task records the failure where its requester will see it
  isLastAttempt: boolean;
}

export interface TaskDefinition {
  name: string;
  title: string;
  // It comes back from the queue's table, so the task parses it
  run: (context: TaskContext, data: unknown) => Promise<void>;
}

export interface QueueStat {
  name: string;
  waiting: number;
  active: number;
  deferred: number;
  failed: number;
}

export type RunRequest = "accepted" | "busy";

export interface JobQueue {
  definitions: JobDefinition[];
  tasks: TaskDefinition[];
  requestRun: (name: string) => Promise<RunRequest>;
  enqueue: (name: string, data: object) => Promise<void>;
  readQueues: () => Promise<QueueStat[]>;
  // The last error of the queue itself: its scheduler and supervisor catch their own and only report them
  lastErrorAt: () => Date | null;
}
