import type { Logger } from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DB_PROFILES, type DbClient } from "../db/client.js";
import { connectTestAppDatabase, connectTestDatabase, testAppDatabaseUrl } from "../db/test-database.js";
import { JOB_EXPIRE_SECONDS, type JobDefinition, type JobOutcome } from "./job.js";
import { createJobQueue, type RunningJobQueue } from "./queue.js";

const WAIT_MS = 12_000;
const POLL_MS = 100;
const POLLING_INTERVAL_SECONDS = 0.5;
const NAME = "test.job";
const DAY_MS = 86_400_000;
const NEVER_BY_ITSELF = "0 2 1 1 *";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function definition(run: () => Promise<JobOutcome>, name = NAME): JobDefinition {
  return {
    name,
    title: "Тестова задача",
    cron: NEVER_BY_ITSELF,
    scheduleLabel: "Ніколи",
    maxSilenceMs: DAY_MS,
    canRunByHand: true,
    run,
  };
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("timed out");
}

// As the runtime role, the way the app runs it: the whole point of installing the schema under the owner
describe("the job queue", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase(DB_PROFILES.worker);
  const running: RunningJobQueue[] = [];

  function queue(definitions: JobDefinition[], role: "all" | "api" = "all"): RunningJobQueue {
    const created = createJobQueue({
      connectionString: testAppDatabaseUrl(),
      role,
      definitions,
      db,
      logger,
      pollingIntervalSeconds: POLLING_INTERVAL_SECONDS,
    });
    running.push(created);
    return created;
  }

  async function clearJobs(): Promise<void> {
    await owner.$executeRaw`DELETE FROM pgboss.schedule WHERE name LIKE 'test.%'`;
    await owner.$executeRaw`DELETE FROM pgboss.job WHERE name LIKE 'test.%'`;
    await owner.$executeRaw`DELETE FROM pgboss.queue WHERE name LIKE 'test.%'`;
    await owner.jobEvent.deleteMany({ where: { jobName: { startsWith: "test." } } });
    await owner.jobHealth.deleteMany({ where: { name: { startsWith: "test." } } });
  }

  beforeAll(clearJobs);

  afterEach(async () => {
    await Promise.all(running.splice(0).map((item) => item.stop()));
    await clearJobs();
  });

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  const finishedRuns = () => owner.jobEvent.count({ where: { jobName: NAME } });

  it("starts as the runtime role, registers the job and schedules it in Kyiv time", async () => {
    const jobs = queue([definition(() => Promise.resolve({}))]);
    await jobs.start();

    expect(jobs.isStarted()).toBe(true);
    expect(await owner.jobHealth.count({ where: { name: NAME } })).toBe(1);
    const rows = await owner.$queryRaw<{ cron: string; timezone: string }[]>`
      SELECT cron, timezone FROM pgboss.schedule WHERE name = ${NAME}
    `;
    expect(rows).toEqual([{ cron: NEVER_BY_ITSELF, timezone: "Europe/Kyiv" }]);
  });

  it("runs a job and records the run and the health", async () => {
    const jobs = queue([definition(() => Promise.resolve({ summary: { sessions: 2 }, skippedItems: 1 }))]);
    await jobs.start();

    expect(await jobs.requestRun(NAME)).toBe("accepted");
    await waitFor(async () => (await finishedRuns()) === 1);

    const [event] = await owner.jobEvent.findMany({ where: { jobName: NAME } });
    expect(event).toMatchObject({ trigger: "manual", isSuccess: true, skippedItems: 1, summary: { sessions: 2 } });
    const health = await owner.jobHealth.findUniqueOrThrow({ where: { name: NAME } });
    expect(health.lastSuccessAt).not.toBeNull();
    expect(health).toMatchObject({ failureStreak: 0, skippedItems: 1, lastError: null });
  });

  it("counts a failure and clears the count with the next success", async () => {
    const run = vi
      .fn<() => Promise<JobOutcome>>()
      .mockRejectedValueOnce(new Error("broke on purpose"))
      .mockResolvedValue({});
    const jobs = queue([definition(run)]);
    await jobs.start();

    await jobs.requestRun(NAME);
    await waitFor(async () => (await finishedRuns()) === 1);
    const failed = await owner.jobHealth.findUniqueOrThrow({ where: { name: NAME } });
    expect(failed).toMatchObject({ failureStreak: 1, lastError: "Error: broke on purpose" });
    expect(failed.lastFailureAt).not.toBeNull();

    // The next attempt is a minute away: this brings it forward. The run is recorded before pg-boss hears of the failure
    await waitFor(
      async () =>
        (await owner.$executeRaw`UPDATE pgboss.job SET start_after = now() WHERE name = ${NAME} AND state = 'retry'`) ===
        1,
    );
    await waitFor(async () => (await finishedRuns()) === 2);
    const healed = await owner.jobHealth.findUniqueOrThrow({ where: { name: NAME } });
    expect(healed).toMatchObject({ failureStreak: 0, lastError: null });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("refuses a second run while one is in the queue, so runs never overlap", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let isRunning = false;
    const jobs = queue([
      definition(async () => {
        isRunning = true;
        await held;
        return {};
      }),
    ]);
    await jobs.start();

    expect(await jobs.requestRun(NAME)).toBe("accepted");
    await waitFor(() => Promise.resolve(isRunning));
    expect(await jobs.requestRun(NAME)).toBe("busy");

    release();
    await waitFor(async () => (await finishedRuns()) === 1);
    expect(await jobs.requestRun(NAME)).toBe("accepted");
    await waitFor(async () => (await finishedRuns()) === 2);
  });

  it("does not run anything in the api role, which only sends and reads", async () => {
    const run = vi.fn(() => Promise.resolve({}));
    const worker = queue([definition(run)]);
    await worker.start();
    await worker.stop();
    running.splice(0);

    const api = queue([definition(run)], "api");
    await api.start();
    expect(await api.requestRun(NAME)).toBe("accepted");
    const stats = await api.readQueues();
    expect(stats.find(({ name }) => name === NAME)?.waiting).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 2 * POLLING_INTERVAL_SECONDS * 1_000));
    expect(run).not.toHaveBeenCalled();
  });

  it("registers the jobs in the api role too, so a stack with no worker still turns red in time", async () => {
    const api = queue([definition(() => Promise.resolve({}))], "api");
    await api.start();
    expect(await owner.jobHealth.count({ where: { name: NAME } })).toBe(1);
  });

  it("holds the start of a run while it runs and clears it after", async () => {
    let finish = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const jobs = queue([
      definition(async () => {
        await held;
        return {};
      }),
    ]);
    await jobs.start();
    await jobs.requestRun(NAME);
    const runningSince = async () => (await owner.jobHealth.findUnique({ where: { name: NAME } }))?.runningSince;

    await waitFor(async () => Boolean(await runningSince()));
    finish();
    await waitFor(async () => (await finishedRuns()) === 1);
    expect(await runningSince()).toBeNull();
  });

  it("brings the retry settings of an existing queue up to date on start", async () => {
    const first = queue([definition(() => Promise.resolve({}))]);
    await first.start();
    await first.stop();
    running.splice(0);
    await owner.$executeRaw`UPDATE pgboss.queue SET retry_limit = 9, expire_seconds = 7 WHERE name = ${NAME}`;

    await queue([definition(() => Promise.resolve({}))]).start();

    const rows = await owner.$queryRaw<{ retryLimit: number; expireSeconds: number }[]>`
      SELECT retry_limit AS "retryLimit", expire_seconds AS "expireSeconds" FROM pgboss.queue WHERE name = ${NAME}
    `;
    expect(rows).toEqual([{ retryLimit: 3, expireSeconds: JOB_EXPIRE_SECONDS }]);
  });

  it("drops the schedule of a job this image does not know", async () => {
    const first = queue([definition(() => Promise.resolve({}), "test.old")]);
    await first.start();
    await first.stop();
    running.splice(0);

    const second = queue([definition(() => Promise.resolve({}))]);
    await second.start();
    const rows = await owner.$queryRaw<{ name: string }[]>`
      SELECT name FROM pgboss.schedule WHERE name LIKE 'test.%' ORDER BY name
    `;
    expect(rows.map(({ name }) => name)).toEqual([NAME]);
  });

  it("keeps the journal of a job to a fixed number of rows", async () => {
    const jobs = queue([definition(() => Promise.resolve({}))]);
    await jobs.start();
    const now = new Date();
    const old = Array.from({ length: 205 }, () => ({
      jobName: NAME,
      trigger: "schedule",
      isSuccess: true,
      startedAt: now,
      finishedAt: now,
    }));
    await owner.jobEvent.createMany({ data: old });

    await jobs.requestRun(NAME);
    await waitFor(async () => (await finishedRuns()) <= 200);
    expect(await finishedRuns()).toBe(200);
  });
});
