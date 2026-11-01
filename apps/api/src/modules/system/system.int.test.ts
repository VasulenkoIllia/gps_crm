import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActivityList, JobList, SystemStatus } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import type { JobDefinition, JobQueue } from "../../core/jobs/job.js";
import { recordJobFailure, recordJobSuccess, registerJobHealth } from "../../core/jobs/job.repository.js";
import { NO_MAIL, testConfig } from "../../core/test-app.js";
import { JOBS } from "../../jobs.js";
import { api, clearAuthData, createUser, signInWithSetup } from "../../test-auth.js";
import { noteDeployment } from "./index.js";

const DAY_MS = 86_400_000;
const CLEAN = "test.clean";
const LOCKED = "test.locked";
const VERSION = "sha-0123456";

function job(name: string, canRunByHand: boolean): JobDefinition {
  return {
    name,
    title: `Задача ${name}`,
    cron: "0 2 * * *",
    scheduleLabel: "Щоночі",
    maxSilenceMs: DAY_MS,
    canRunByHand,
    run: () => Promise.resolve({}),
  };
}

describe("the «Система» screen", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  const statusDir = mkdtempSync(join(tmpdir(), "backup-status-"));
  const requestRun = vi.fn<JobQueue["requestRun"]>();
  const readQueues = vi.fn<JobQueue["readQueues"]>();
  const lastErrorAt = vi.fn<JobQueue["lastErrorAt"]>();
  let app: FastifyInstance;
  let cookie: string;

  const origin = { origin: testConfig().appUrl };
  const status = async () => {
    const response = await api(app, "GET", "/system/status", { cookie });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SystemStatus>();
  };
  const jobsPage = async () => {
    const response = await api(app, "GET", "/system/jobs", { cookie });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<JobList>();
  };

  function writeStatus(file: string, age: number, extra: object = {}): void {
    const at = new Date(Date.now() - age).toISOString();
    const body = { schema: 1, environment: "staging", finishedAt: at, ok: true, reason: null, lastOkAt: at, ...extra };
    writeFileSync(join(statusDir, file), JSON.stringify(body));
  }

  async function clearJobs(): Promise<void> {
    await owner.jobEvent.deleteMany();
    await owner.jobHealth.deleteMany();
  }

  // An app per test: the limit on sign-in counts per instance, and every test signs in
  beforeEach(async () => {
    app = await buildApp({
      db,
      config: testConfig({ backupStatusDir: statusDir, appVersion: VERSION }),
      mailer: NO_MAIL,
      jobs: { definitions: [job(CLEAN, true), job(LOCKED, false)], requestRun, readQueues, lastErrorAt },
      checkReady: () => Promise.resolve(),
    });
    await clearAuthData(owner);
    await clearJobs();
    rmSync(join(statusDir, "dump.json"), { force: true });
    rmSync(join(statusDir, "check.json"), { force: true });
    const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    ({ cookie } = await signInWithSetup(app, owner, admin));
    requestRun.mockReset().mockResolvedValue("accepted");
    readQueues.mockReset().mockResolvedValue([]);
    lastErrorAt.mockReset().mockReturnValue(null);
  });

  afterEach(() => app.close());

  afterAll(async () => {
    rmSync(statusDir, { recursive: true });
    await clearJobs();
    await owner.$disconnect();
    await db.$disconnect();
  });

  describe("GET /system/status", () => {
    it("reads the last backup from the status files", async () => {
      writeStatus("dump.json", 60_000, { dumpBytes: 4096, copies: 9 });
      writeStatus("check.json", DAY_MS, { dump: "scheduled-x.dump", tables: 15, tablesCompared: true });

      const { backups } = await status();

      expect(backups.dump).toMatchObject({ state: "good", dumpBytes: 4096, copies: 9 });
      expect(backups.restoreCheck).toMatchObject({ state: "good", tables: 15 });
    });

    it("is red when the status file is missing", async () => {
      expect((await status()).backups.dump).toMatchObject({ state: "critical", label: "Бекапи не налаштовані" });
    });

    it("is red when the status file does not parse", async () => {
      writeFileSync(join(statusDir, "dump.json"), "{ not json");
      expect((await status()).backups.dump.label).toBe("Стан бекапів не читається");
    });

    it("does not take a stale backup for a good one", async () => {
      writeStatus("dump.json", 8 * 60 * 60 * 1_000);
      expect((await status()).backups.dump).toMatchObject({ state: "critical", label: "Бекап застарів" });
    });

    it("shows the size of the database, with the journal as one table", async () => {
      const { database } = await status();
      expect(database.sizeBytes).toBeGreaterThan(0);
      expect(database.tables.length).toBeGreaterThan(0);
      expect(database.tables.filter(({ name }) => name.startsWith("activity_events_"))).toEqual([]);
    });

    it("shows the disk with a percentage", async () => {
      const { disk } = await status();
      expect(disk.usedPercent).toBeGreaterThanOrEqual(0);
      expect(disk.freeBytes).toBeGreaterThan(0);
    });

    it("labels the queues with the titles of their jobs", async () => {
      readQueues.mockResolvedValue([{ name: CLEAN, waiting: 2, active: 1, deferred: 0, failed: 3 }]);
      expect((await status()).queues).toEqual([
        { name: CLEAN, label: `Задача ${CLEAN}`, waiting: 2, active: 1, deferred: 0, failed: 3 },
      ]);
    });

    it("keeps the backups on the screen when the queues cannot be read, and goes red for the queues", async () => {
      writeStatus("dump.json", 60_000);
      readQueues.mockRejectedValue(new Error("Queue test.clean does not exist"));

      const answer = await status();

      expect(answer.queueState).toMatchObject({ state: "critical", label: "Черги не читаються" });
      expect(answer.queues).toEqual([]);
      expect(answer.backups.dump.state).toBe("good");
    });

    it("goes red for a fresh error of the queue itself", async () => {
      lastErrorAt.mockReturnValue(new Date());
      expect((await status()).queueState.state).toBe("critical");
    });

    it("shows the running version and the deployments, newest first", async () => {
      await noteDeployment(db, "sha-old");
      await noteDeployment(db, VERSION);

      expect((await status()).version).toMatchObject({
        current: VERSION,
        deployments: [
          { version: VERSION, previousVersion: "sha-old" },
          { version: "sha-old", previousVersion: null },
        ],
      });
    });

    it("needs a session", async () => {
      expect((await api(app, "GET", "/system/status")).statusCode).toBe(401);
    });
  });

  describe("noteDeployment", () => {
    it("writes a version once, and again when a rollback brings an older one back", async () => {
      expect(await noteDeployment(db, "sha-1")).toBe(true);
      expect(await noteDeployment(db, "sha-1")).toBe(false);
      expect(await noteDeployment(db, "sha-2")).toBe(true);
      expect(await noteDeployment(db, "sha-1")).toBe(true);
      expect(await owner.activityEvent.count({ where: { action: "system.deployed" } })).toBe(3);
    });
  });

  describe("GET /system/jobs", () => {
    const run = { jobName: CLEAN, trigger: "schedule" as const, startedAt: new Date(), finishedAt: new Date() };

    it("shows every registered job, even one that never ran", async () => {
      const { items } = await jobsPage();
      expect(items.map((item) => item.name)).toEqual([CLEAN, LOCKED]);
      expect(items[0]).toMatchObject({ state: "waiting", lastSuccessAt: null, runs: [] });
    });

    it("shows the history of a job and goes red after a failure", async () => {
      await registerJobHealth(db, CLEAN);
      await recordJobSuccess(db, run, { skippedItems: 0 });
      await recordJobFailure(db, run, "Error: broke");

      const item = (await jobsPage()).items.find(({ name }) => name === CLEAN);

      expect(item).toMatchObject({ state: "critical", failureStreak: 1, lastError: "Error: broke" });
      expect(item?.runs.map((entry) => entry.isSuccess)).toEqual([false, true]);
    });

    it("shows the jobs the app really runs", () => {
      expect(JOBS.map(({ name }) => name).sort()).toEqual([
        "activity.partitions",
        "auth.cleanup",
        "subscribers.rollup-reconcile",
      ]);
    });
  });

  describe("POST /system/jobs/:name/run", () => {
    const start = (name: string) => api(app, "POST", `/system/jobs/${name}/run`, { cookie, headers: origin });

    it("queues the job and writes who asked for it", async () => {
      expect((await start(CLEAN)).statusCode).toBe(202);

      expect(requestRun).toHaveBeenCalledWith(CLEAN);
      const journal = await api(app, "GET", "/activity?action=job.run_requested", { cookie });
      expect(journal.json<ActivityList>().items[0]).toMatchObject({
        actorKind: "user",
        details: [{ field: "job", value: `Задача ${CLEAN}` }],
      });
    });

    it("says so when the job is already running, and writes nothing", async () => {
      requestRun.mockResolvedValue("busy");

      const response = await start(CLEAN);

      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe("job_busy");
      expect(await owner.activityEvent.count({ where: { action: "job.run_requested" } })).toBe(0);
    });

    it("refuses a job that is closed to a manual run", async () => {
      expect((await start(LOCKED)).statusCode).toBe(409);
      expect(requestRun).not.toHaveBeenCalled();
    });

    it("answers 404 for a job that is not registered, so nothing else reaches the queue", async () => {
      expect((await start("test.unknown")).statusCode).toBe(404);
      expect(requestRun).not.toHaveBeenCalled();
    });

    it("answers 400 for a name of the wrong shape", async () => {
      expect((await start("NAME;DROP")).statusCode).toBe(400);
    });

    it("refuses a foreign site and a stranger", async () => {
      const foreign = await api(app, "POST", `/system/jobs/${CLEAN}/run`, {
        cookie,
        headers: { origin: "https://evil.example" },
      });
      expect(foreign.statusCode).toBe(403);
      expect((await api(app, "POST", `/system/jobs/${CLEAN}/run`, { headers: origin })).statusCode).toBe(401);
      expect(requestRun).not.toHaveBeenCalled();
    });
  });
});
