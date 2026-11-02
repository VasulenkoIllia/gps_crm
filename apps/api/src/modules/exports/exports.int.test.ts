import { once } from "node:events";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { addDays, reverseDigits, todayKyiv, type ExportJob } from "@gps_crm/shared";
import ExcelJS from "exceljs";
import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DB_PROFILES, type DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { createFileStorage, type FileStorage } from "../../core/files/file-storage.js";
import type { JobQueue, TaskContext } from "../../core/jobs/job.js";
import { NO_JOBS, testConfig } from "../../core/test-app.js";
import { createUser } from "../../test-auth.js";
import { companyForm } from "../../test-clients.js";
import { resetObjects, setScope, startObjectApi, type ObjectApi } from "../../test-objects.js";
import { items, withoutPermission, type JournalLine } from "../../test-references.js";
import { cleanUpExports } from "./exports.build.js";
import { EXPORT_BUILD_TASK, EXPORTS_CLEANUP_JOB } from "./exports.jobs.js";

const IMEI_BASE = 990_000_000_000_000;
const DAY_MS = 86_400_000;
// More than a batch of the reading (exports.sheet.ts), so the keyset turns at least once
const MANY_DEVICES = 1_001;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// The files of an export on the disk, whatever the folders under it
async function filesOf(exportId: string): Promise<string[]> {
  const entries = await readdir(join(testConfig().files.dir, "export", exportId), {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function readSheet(response: LightMyRequestResponse): Promise<unknown[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.rawPayload as unknown as ArrayBuffer);
  const rows: unknown[][] = [];
  workbook.worksheets[0]?.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return rows;
}

describe("exports to Excel", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  const workerDb: DbClient = connectTestAppDatabase(DB_PROFILES.worker);
  const files = createFileStorage(testConfig().files);
  const queued: object[] = [];
  let isQueueDown = false;
  const jobs: JobQueue = {
    ...NO_JOBS,
    enqueue: (_name, data) => {
      if (isQueueDown) return Promise.reject(new Error("the queue is down"));
      queued.push(data);
      return Promise.resolve();
    },
  };
  let client: ObjectApi;

  const context = (): TaskContext => ({
    db: workerDb,
    logger,
    files,
    signal: new AbortController().signal,
    isLastAttempt: true,
  });
  const request = async (body: object): Promise<ExportJob> => {
    const response = await client.call("POST", "/exports", body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json<ExportJob>();
  };
  // What the worker does with the job the request queued
  const runQueued = async () => {
    for (const data of queued.splice(0)) await EXPORT_BUILD_TASK.run(context(), data);
  };
  const status = async (id: string) => (await client.call("GET", `/exports/${id}`)).json<ExportJob>();
  const journal = async (action: string) => items<JournalLine>(await client.call("GET", `/activity?action=${action}`));
  const facts = (line: JournalLine | undefined) =>
    Object.fromEntries((line?.details ?? []).map(({ field, value }) => [field, value]));

  beforeAll(async () => {
    await files.prepare();
    client = await startObjectApi(db, owner, jobs);
  });

  beforeEach(async () => {
    queued.length = 0;
    isQueueDown = false;
    await resetObjects(client, owner);
  });

  afterAll(async () => {
    await client.app.close();
    await Promise.all([db.$disconnect(), workerDb.$disconnect(), owner.$disconnect()]);
  });

  it("builds the filtered list in the background, in the order of the screen, and writes it to the journal", async () => {
    await client.createClient({ name: "=SUM(A1) Формула", legacyCode: "С-1" });
    await client.call("POST", "/subscribers", companyForm(client, { name: "ТОВ Фірма" }));

    const job = await request({ entity: "subscribers", filters: { type: "B2C" }, sort: "name", order: "asc" });
    expect(job).toMatchObject({ status: "queued", rowCount: null });
    expect(queued).toEqual([{ exportId: job.id }]);
    await runQueued();

    expect(await status(job.id)).toMatchObject({ status: "done", rowCount: 2, error: null });
    const file = await client.call("GET", `/exports/${job.id}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-disposition"]).toContain("attachment");
    const [header, first, second] = await readSheet(file);
    expect(header?.slice(0, 3)).toEqual(["ID", "Старий номер", "Назва"]);
    expect(first?.slice(1, 3)).toEqual(["С-1", "'=SUM(A1) Формула"]);
    expect(typeof first?.[0]).toBe("number");
    expect(first?.at(-1)).toBeInstanceOf(Date);
    expect(second?.[2]).toBe("Клієнт");

    const [completed] = await journal("export.completed");
    expect(facts(completed)).toMatchObject({ list: "Клієнти", rowCount: 2, filters: "Тип: Фізична особа (B2C)" });
    expect(facts((await journal("export.downloaded"))[0])).toMatchObject({ list: "Клієнти" });
  });

  it("takes the contracts with the filters of their list and their own day", async () => {
    const today = todayKyiv();
    const { id } = await client.createClient({ name: "Клієнт з договорами" });
    const [payer] = items<{ id: string }>(await client.call("GET", `/subscribers/${id}/payers`));
    const contract = (number: string, validUntil: string) =>
      client.call("POST", `/subscribers/${id}/contracts`, {
        payerId: payer?.id,
        number,
        signedOn: addDays(today, -100),
        validUntil,
      });
    expect((await contract("Д-1", addDays(today, 10))).statusCode).toBe(201);
    expect((await contract("Д-2", addDays(today, 200))).statusCode).toBe(201);

    const job = await request({ entity: "contracts", filters: { expiring: "true" } });
    await runQueued();

    expect(await status(job.id)).toMatchObject({ status: "done", rowCount: 1 });
    const [header, row] = await readSheet(await client.call("GET", `/exports/${job.id}/file`));
    expect(header?.slice(0, 3)).toEqual(["Номер", "ID клієнта", "Клієнт"]);
    expect(row?.[0]).toBe("Д-1");
    expect(row?.[6]).toBe("так");
    const [completed] = await journal("export.completed");
    expect(facts(completed)).toMatchObject({ list: "Договори", rowCount: 1, filters: "Спливають: за 30 днів" });
  });

  it("reads a long list page by page", async () => {
    await owner.device.createMany({
      data: Array.from({ length: MANY_DEVICES }, (_, index) => {
        const imei = String(IMEI_BASE + index);
        return { imei, imeiRev: reverseDigits(imei) };
      }),
    });

    const job = await request({ entity: "devices", filters: { status: "removed" } });
    await runQueued();

    expect(await status(job.id)).toMatchObject({ status: "done", rowCount: MANY_DEVICES });
    const rows = await readSheet(await client.call("GET", `/exports/${job.id}/file`));
    expect(new Set(rows.slice(1).map((row) => row[0])).size).toBe(MANY_DEVICES);
  });

  it("takes a finished export only once", async () => {
    const job = await request({ entity: "objects", filters: {} });
    const [data] = queued;
    await runQueued();
    await EXPORT_BUILD_TASK.run(context(), data);

    expect(await owner.storedFile.count({ where: { ownerType: "export" } })).toBe(1);
    expect((await status(job.id)).status).toBe("done");
  });

  it("exports at the level `own` only the person's clients", async () => {
    const other = await createUser(owner, { email: "other@example.test" });
    await client.createClient({ name: "Чужий клієнт", managerId: other.id });
    await setScope(owner, "data.export", "own");
    try {
      const job = await request({ entity: "subscribers", filters: {} });
      await runQueued();
      expect((await status(job.id)).rowCount).toBe(1);
    } finally {
      await setScope(owner, "data.export", "all");
    }
  });

  it("exports at the level `own` only the objects of the person's clients", async () => {
    await client.createObject();
    const other = await createUser(owner, { email: "manager@example.test" });
    await owner.subscriber.update({ where: { id: client.subscriberId }, data: { managerId: other.id } });
    await setScope(owner, "objects.read", "own");
    try {
      const job = await request({ entity: "objects", filters: {} });
      await runQueued();
      expect(await status(job.id)).toMatchObject({ status: "done", rowCount: 0 });
    } finally {
      await setScope(owner, "objects.read", "all");
    }
  });

  it("stops when the storage fails midway, and the last attempt fails the export", async () => {
    const job = await request({ entity: "subscribers", filters: {} });
    // What a full disk does: the first bytes go, then the writing breaks the chain it is in
    const fullDisk: FileStorage = {
      ...files,
      putStream: async (_key, content) => {
        await once(content, "data");
        const error = new Error("no space left on device");
        content.destroy(error);
        throw error;
      },
    };

    const [data] = queued.splice(0);
    await expect(EXPORT_BUILD_TASK.run({ ...context(), files: fullDisk }, data)).rejects.toThrow("no space left");

    expect(await status(job.id)).toMatchObject({
      status: "failed",
      error: "Не вдалося сформувати файл. Спробуйте ще раз.",
    });
    expect(await owner.storedFile.count({ where: { ownerType: "export" } })).toBe(0);
  });

  it("keeps no second file when the export was finished elsewhere meanwhile", async () => {
    const job = await request({ entity: "subscribers", filters: {} });
    // exports.cleanup gives up on a run that took too long, while the run still writes
    const lateRun: FileStorage = {
      ...files,
      putStream: async (key, content) => {
        await files.putStream(key, content);
        await owner.exportJob.update({
          where: { id: job.id },
          data: { status: "failed", error: "Не вдалося", finishedAt: new Date() },
        });
      },
    };

    const [data] = queued.splice(0);
    await EXPORT_BUILD_TASK.run({ ...context(), files: lateRun }, data);

    expect((await status(job.id)).status).toBe("failed");
    expect(await owner.storedFile.count({ where: { ownerType: "export" } })).toBe(0);
    expect(await filesOf(job.id)).toEqual([]);
    expect(await journal("export.completed")).toEqual([]);
  });

  it("takes no more than three open exports of a person", async () => {
    for (let index = 0; index < 3; index += 1) await request({ entity: "sensors", filters: {} });

    const fourth = await client.call("POST", "/exports", { entity: "sensors", filters: {} });
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json<{ code: string }>().code).toBe("exports_busy");
    await runQueued();
    await request({ entity: "sensors", filters: {} });
  });

  it("keeps the export of a person to that person", async () => {
    const job = await request({ entity: "sims", filters: {} });
    const other = await createUser(owner, { email: "someone@example.test" });
    await owner.exportJob.update({ where: { id: job.id }, data: { requestedBy: other.id } });

    expect((await client.call("GET", `/exports/${job.id}`)).statusCode).toBe(404);
    expect((await client.call("GET", `/exports/${job.id}/file`)).statusCode).toBe(404);
  });

  it("refuses without the permission to export or to read the list, and a file that is not ready", async () => {
    const forbidden = await withoutPermission(owner, "data.export", () =>
      client.call("POST", "/exports", { entity: "subscribers", filters: {} }),
    );
    expect(forbidden.statusCode).toBe(403);
    const unreadable = await withoutPermission(owner, "objects.read", () =>
      client.call("POST", "/exports", { entity: "objects", filters: {} }),
    );
    expect(unreadable.statusCode).toBe(403);
    const unknownFilter = await client.call("POST", "/exports", { entity: "sensors", filters: { status: "x" } });
    expect(unknownFilter.statusCode).toBe(400);

    const job = await request({ entity: "sensors", filters: {} });
    expect((await client.call("GET", `/exports/${job.id}/file`)).statusCode).toBe(409);
  });

  it("answers 503 and fails the export when the queue does not take it", async () => {
    isQueueDown = true;
    const response = await client.call("POST", "/exports", { entity: "subscribers", filters: {} });

    expect(response.statusCode).toBe(503);
    expect(await owner.exportJob.findMany({ select: { status: true } })).toEqual([{ status: "failed" }]);
  });

  it("removes the file after 24 hours and fails what no run will finish", async () => {
    const done = await request({ entity: "subscribers", filters: {} });
    await runQueued();
    const lost = await request({ entity: "objects", filters: {} });
    queued.length = 0;
    // What a run killed midway leaves behind
    await files.put(`export/${lost.id}/ab/partial`, Buffer.from("PK"));
    const { file } = await owner.exportJob.findUniqueOrThrow({ where: { id: done.id }, select: { file: true } });
    const later = new Date(Date.now() + DAY_MS + 60_000);
    await owner.exportJob.update({ where: { id: lost.id }, data: { createdAt: new Date(Date.now() - DAY_MS) } });

    expect((await client.call("GET", `/exports/${done.id}/file`)).statusCode).toBe(200);
    const outcome = await EXPORTS_CLEANUP_JOB.run({ db: workerDb, logger, files });
    expect(outcome.summary).toEqual({ expired: 0, failed: 1 });
    expect((await cleanUpExports({ db: workerDb, logger, files }, later)).summary).toEqual({ expired: 1, failed: 0 });

    expect(await status(done.id)).toMatchObject({ status: "expired" });
    const failed = await status(lost.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Не вдалося");
    expect((await client.call("GET", `/exports/${done.id}/file`)).statusCode).toBe(410);
    expect(await owner.storedFile.count({ where: { ownerType: "export" } })).toBe(0);
    expect(file && (await files.openStream(file.key))).toBeNull();
    expect(await filesOf(lost.id)).toEqual([]);
    expect(await filesOf(done.id)).toEqual([]);
  });
});
