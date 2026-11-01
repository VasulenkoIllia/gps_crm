import type { Logger } from "pino";
import { PgBoss, type ConstructorOptions, type Queue, type QueueStats } from "pg-boss";
import type { AppRole } from "../config.js";
import type { DbClient } from "../db/client.js";
import { grantJobSchema } from "./grants.repository.js";
import { JOB_EXPIRE_SECONDS, type JobDefinition, type JobQueue, type JobTrigger, type QueueStat } from "./job.js";
import { registerJobHealth } from "./job.repository.js";
import { runJob } from "./run-job.js";

const TIME_ZONE = "Europe/Kyiv";
const SCHEMA = "pgboss";
const POOL_MAX_CONNECTIONS = 5;
const POLLING_INTERVAL_SECONDS = 5;
// Inside the 25 s of core/shutdown.ts, which the server's own close takes its part of first
const GRACEFUL_STOP_MS = 15_000;
// 1 + 2 + 4 + 8 + 16 s: the database of a restarted stack is up within that
const START_ATTEMPTS = 6;
// Its own statements only: maintenance and fetches of pg-boss, not the jobs, which run on the worker profile
const STATEMENT_TIMEOUT_MS = 60_000;

// Apart from the policy: createQueue leaves an existing queue as it was, so these go to updateQueue on every start, and a
// policy cannot change after the queue is made
const RETRY_OPTIONS = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  expireInSeconds: JOB_EXPIRE_SECONDS,
} satisfies Omit<Queue, "name">;

// exclusive: one job queued or active, so a late run never overlaps the next (system.md §11) and a second press of the
// button is refused
const QUEUE_OPTIONS = { ...RETRY_OPTIONS, policy: "exclusive" } satisfies Omit<Queue, "name">;

interface JobData {
  trigger: JobTrigger;
}

function bossOptions(connectionString: string): ConstructorOptions {
  return {
    connectionString,
    schema: SCHEMA,
    max: POOL_MAX_CONNECTIONS,
    options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
    // Needs to own the indexes, and the runtime role owns nothing
    reindex: false,
  };
}

function reportErrors(boss: PgBoss, logger: Pick<Logger, "warn" | "error">, onError?: () => void): void {
  boss.on("error", (error) => {
    logger.error({ err: error }, "pg-boss error");
    onError?.();
  });
  boss.on("warning", (warning) => logger.warn({ warning }, "pg-boss warning"));
}

// Runs as the schema owner, in the deploy step (setup.ts): the running app has no DDL, and starts with migrate off.
// A newer pg-boss with a newer schema migrates here as well, under the same lock_timeout as the migrations.
export async function installJobSchema(
  connectionString: string,
  db: DbClient,
  logger: Pick<Logger, "warn" | "error">,
): Promise<void> {
  const boss = new PgBoss({
    ...bossOptions(connectionString),
    migrate: true,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  reportErrors(boss, logger);
  await boss.start();
  await boss.stop({ graceful: false });
  await grantJobSchema(db);
}

interface JobQueueOptions {
  connectionString: string;
  role: AppRole;
  definitions: JobDefinition[];
  // Worker profile
  db: DbClient;
  logger: Logger;
  pollingIntervalSeconds?: number;
}

export interface RunningJobQueue extends JobQueue {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isStarted: () => boolean;
}

function toQueueStat(stats: QueueStats): QueueStat {
  return {
    name: stats.name,
    waiting: stats.readyCount,
    active: stats.activeCount,
    deferred: stats.deferredCount,
    failed: stats.failedCount,
  };
}

// api sends and reads, all and worker also run: the same image, one role per container (02-architecture.md §2.1).
// Nothing here creates a table: a queue is a row in the shared job table.
export function createJobQueue(options: JobQueueOptions): RunningJobQueue {
  const { connectionString, role, definitions, db, logger } = options;
  const pollingIntervalSeconds = options.pollingIntervalSeconds ?? POLLING_INTERVAL_SECONDS;
  const isWorker = role !== "api";
  const boss = new PgBoss({
    ...bossOptions(connectionString),
    migrate: false,
    supervise: isWorker,
    schedule: isWorker,
    instanceName: role,
  });
  let isStarted = false;
  let lastErrorAt: Date | null = null;
  reportErrors(boss, logger, () => {
    lastErrorAt = new Date();
  });

  async function startWork(definition: JobDefinition): Promise<void> {
    const { name, cron } = definition;
    await boss.createQueue(name, QUEUE_OPTIONS);
    await boss.updateQueue(name, RETRY_OPTIONS);
    // missed: a deploy or a restart at the scheduled minute must not cost a monthly job its month
    await boss.schedule(name, cron, { trigger: "schedule" } satisfies JobData, { tz: TIME_ZONE, missed: "once" });
    await boss.work<JobData>(name, { pollingIntervalSeconds, localConcurrency: 1 }, async ([job]) => {
      if (job) await runJob(definition, { db, logger }, job.data?.trigger ?? "schedule");
    });
  }

  // A job this image does not know: a schedule left by a newer version after a rollback would fill its queue
  async function dropForeignSchedules(): Promise<void> {
    const known = new Set(definitions.map(({ name }) => name));
    for (const schedule of await boss.getSchedules()) {
      if (!known.has(schedule.name)) await boss.unschedule(schedule.name, schedule.key);
    }
  }

  return {
    definitions,
    isStarted: () => isStarted,
    lastErrorAt: () => lastErrorAt,

    async start() {
      await boss.start({ attempts: START_ATTEMPTS });
      // By every role: a stack with no worker must turn red in time, not wait for a row only a worker would write
      for (const { name } of definitions) await registerJobHealth(db, name);
      if (isWorker) {
        await dropForeignSchedules();
        for (const definition of definitions) await startWork(definition);
      }
      isStarted = true;
    },

    async stop() {
      isStarted = false;
      await boss.stop({ graceful: true, timeout: GRACEFUL_STOP_MS });
    },

    async requestRun(name) {
      const id = await boss.send(name, { trigger: "manual" } satisfies JobData);
      return id ? "accepted" : "busy";
    },

    // force: the plain reading is a cache only the supervisor refreshes, and the api role has no supervisor
    async readQueues() {
      const stats = await Promise.all(definitions.map(({ name }) => boss.getQueueStats(name, { force: true })));
      return stats.flat().map(toQueueStat);
    },
  };
}
