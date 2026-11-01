import type { ActivityList, ArchiveList } from "@gps_crm/shared";
import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import { recordActivity, SYSTEM_ACTOR } from "../../core/activity/activity.repository.js";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase, testAppDatabaseUrl } from "../../core/db/test-database.js";
import { AppError } from "../../core/errors.js";
import { NO_JOBS, NO_MAIL, testConfig } from "../../core/test-app.js";
import { PrismaClient } from "../../generated/prisma/client.js";
import { api, clearAuthData, createUser, NEW_PASSWORD, signInWithSetup, STRONG_PASSWORD } from "../../test-auth.js";
import { openArchiveBatch, type ArchiveRestorer } from "./index.js";

const SYSTEM_CONTEXT = { actor: SYSTEM_ACTOR, ip: null, requestId: null };
const RECORDS = "test_record";
const SAME_MOMENT = "2026-11-20T10:00:00.000000Z";

// For the rule that a list costs the same number of queries at any length (06-quality.md §6.1)
function connectCountingDatabase() {
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testAppDatabaseUrl() }),
    log: [{ emit: "event", level: "query" }],
  });
  let count = 0;
  client.$on("query", () => {
    count += 1;
  });
  return {
    db: client,
    takeCount() {
      const taken = count;
      count = 0;
      return taken;
    },
  };
}

describe("the journal and the archive", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  const counting = connectCountingDatabase();
  const restoreRecords = vi.fn<ArchiveRestorer>();
  let app: FastifyInstance;
  let cookie: string;
  let adminId: string;

  const list = async (query = "") => {
    const response = await api(app, "GET", `/activity${query}`, { cookie });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ActivityList>();
  };

  // An app per test: the limit on sign-in counts per instance, and every test signs in
  beforeEach(async () => {
    app = await buildApp({
      db,
      config: testConfig(),
      mailer: NO_MAIL,
      jobs: NO_JOBS,
      checkReady: () => Promise.resolve(),
      archiveRestorers: { [RECORDS]: restoreRecords },
    });
    await owner.archiveBatch.deleteMany();
    await clearAuthData(owner);
    const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    adminId = admin.id;
    ({ cookie } = await signInWithSetup(app, owner, admin));
    restoreRecords.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => app.close());

  afterAll(async () => {
    await owner.archiveBatch.deleteMany();
    await owner.$disconnect();
    await db.$disconnect();
    await counting.db.$disconnect();
  });

  describe("GET /activity", () => {
    it("shows who changed what, with the value before and after", async () => {
      await api(app, "PATCH", "/me", { cookie, payload: { fullName: "Нове Ім'я" } });

      const { items } = await list("?action=user.profile_updated");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        actorKind: "user",
        actorName: "Нове Ім'я",
        action: "user.profile_updated",
        entityType: "user",
        entityId: adminId,
        entityLabel: "Нове Ім'я",
        changes: [{ field: "fullName", before: "Користувач admin@example.test", after: "Нове Ім'я" }],
        details: [],
      });
    });

    it("keeps a plain fact apart from a change", async () => {
      await recordActivity(db, SYSTEM_CONTEXT, { action: "system.deployed", details: { version: "sha-1" } });

      const { items } = await list("?action=system.deployed");
      expect(items[0]).toMatchObject({
        actorKind: "system",
        actorName: null,
        changes: [],
        details: [{ field: "version", value: "sha-1" }],
      });
    });

    it("never shows the secret of a password change, only that it happened", async () => {
      const changed = await api(app, "POST", "/me/password", {
        cookie,
        payload: { currentPassword: STRONG_PASSWORD, newPassword: NEW_PASSWORD },
      });
      expect(changed.statusCode, changed.body).toBe(204);

      const { items } = await list("?action=auth.password_changed");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ entityId: adminId, changes: [], details: [] });
      expect(JSON.stringify(items)).not.toContain(NEW_PASSWORD);
    });

    it("filters by period, person, kind of record and id", async () => {
      const other = await createUser(owner, { email: "other@example.test" });
      await recordActivity(
        db,
        { ...SYSTEM_CONTEXT, actor: { kind: "user", id: other.id } },
        {
          action: "user.blocked",
          entityType: "user",
          entityId: adminId,
        },
      );

      expect((await list(`?actorId=${other.id}`)).items.map((item) => item.action)).toEqual(["user.blocked"]);
      expect((await list(`?entityId=${adminId}&action=user.blocked`)).items).toHaveLength(1);
      expect((await list("?entityType=job")).items).toEqual([]);

      const later = new Date(Date.now() + 60_000).toISOString();
      expect((await list(`?from=${later}`)).items).toEqual([]);
      expect((await list(`?to=${later}`)).items.length).toBeGreaterThan(0);
    });

    it("walks a long journal page by page without a gap, also through rows of one millisecond", async () => {
      const rows = Array.from({ length: 12 }, (_, index) => ({
        occurredAt: new Date(SAME_MOMENT),
        actorKind: "system" as const,
        action: "user.unblocked",
        entityType: `row-${index}`,
      }));
      await owner.activityEvent.createMany({ data: rows });
      await owner.$executeRaw`
        UPDATE activity_events SET occurred_at = occurred_at + (substr(entity_type, 5)::int * interval '100 microseconds')
        WHERE action = 'user.unblocked'
      `;

      const seen: (string | null)[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const page: ActivityList = await list(`?action=user.unblocked&limit=5${query}`);
        seen.push(...page.items.map((item) => item.entityType));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toEqual(rows.map((_, index) => `row-${11 - index}`));
    });

    it("costs the same number of queries for 25 rows and for 100", async () => {
      await owner.activityEvent.createMany({
        data: Array.from({ length: 100 }, () => ({ actorKind: "system" as const, action: "user.unblocked" })),
      });
      const countingApp = await buildApp({
        db: counting.db,
        config: testConfig(),
        mailer: NO_MAIL,
        jobs: NO_JOBS,
        checkReady: () => Promise.resolve(),
      });
      const queriesFor = async (limit: number) => {
        counting.takeCount();
        const response = await api(countingApp, "GET", `/activity?limit=${limit}`, { cookie });
        expect(response.json<ActivityList>().items.length).toBe(limit);
        return counting.takeCount();
      };

      expect(await queriesFor(100)).toBe(await queriesFor(25));
      await countingApp.close();
    });

    it.each(["?limit=0", "?sort=ip", "?action=nothing", "?cursor=abc", "?actorId=1", "?from=yesterday"])(
      "answers %s with a validation error",
      async (query) => {
        const response = await api(app, "GET", `/activity${query}`, { cookie });
        expect(response.statusCode).toBe(400);
        expect(response.json<{ code: string }>().code).toBe("validation_failed");
      },
    );

    it("closes the journal to a stranger", async () => {
      expect((await api(app, "GET", "/activity")).statusCode).toBe(401);
      expect((await api(app, "GET", "/activity/actors")).statusCode).toBe(401);
    });
  });

  describe("GET /activity/actors", () => {
    it("lists the people for the filter, by name", async () => {
      await createUser(owner, { email: "anna@example.test" });
      const response = await api(app, "GET", "/activity/actors", { cookie });
      const { items } = response.json<{ items: { fullName: string }[] }>();
      expect(items.map((item) => item.fullName)).toEqual([
        "Користувач admin@example.test",
        "Користувач anna@example.test",
      ]);
    });
  });

  describe("the archive", () => {
    const context = () => ({ actor: { kind: "user" as const, id: adminId }, ip: null, requestId: null });
    const openBatch = (entityType = RECORDS, label = "Клієнт 10001 і пов'язані записи") =>
      openArchiveBatch(db, context(), { entityType, label, itemCount: 3 });
    const restore = (id: string) =>
      api(app, "POST", `/archive/${id}/restore`, { cookie, headers: { origin: testConfig().appUrl } });

    it("shows a package with who archived it", async () => {
      const id = await openBatch();

      const response = await api(app, "GET", "/archive", { cookie });
      expect(response.statusCode).toBe(200);
      expect(response.json<ArchiveList>().items).toEqual([
        {
          id,
          entityType: RECORDS,
          label: "Клієнт 10001 і пов'язані записи",
          itemCount: 3,
          archivedAt: expect.any(String) as string,
          archivedByName: "Користувач admin@example.test",
        },
      ]);
    });

    it("pages through packages, newest first", async () => {
      const first = await openBatch();
      const second = await openBatch();

      const page = (await api(app, "GET", "/archive?limit=1", { cookie })).json<ArchiveList>();
      expect(page.items.map((item) => item.id)).toEqual([second]);
      const next = await api(app, "GET", `/archive?limit=1&cursor=${page.nextCursor ?? ""}`, { cookie });
      expect(next.json<ArchiveList>()).toMatchObject({ items: [{ id: first }], nextCursor: null });
    });

    it("brings a package back, takes it off the list and writes the journal", async () => {
      const id = await openBatch();

      expect((await restore(id)).statusCode).toBe(204);

      expect(restoreRecords).toHaveBeenCalledOnce();
      expect((await api(app, "GET", "/archive", { cookie })).json<ArchiveList>().items).toEqual([]);
      expect((await list("?action=record.restored")).items[0]).toMatchObject({
        entityType: "archive_batch",
        entityId: id,
        details: [
          { field: "kind", value: RECORDS },
          { field: "itemCount", value: 3 },
        ],
      });
      const row = await owner.archiveBatch.findUniqueOrThrow({ where: { id } });
      expect(row.restoredBy).toBe(adminId);
    });

    it("restores a package once, however fast two people press", async () => {
      const id = await openBatch();

      const answers = await Promise.all([restore(id), restore(id)]);

      expect(answers.map((answer) => answer.statusCode).sort()).toEqual([204, 409]);
      expect(restoreRecords).toHaveBeenCalledOnce();
    });

    it("says what stands in the way and leaves the package in the archive", async () => {
      const id = await openBatch();
      restoreRecords.mockRejectedValue(new AppError(409, "parent_deleted", "Клієнта цього запису вже видалено"));

      const response = await restore(id);

      expect(response.statusCode).toBe(409);
      expect(response.json<{ message: string }>().message).toBe("Клієнта цього запису вже видалено");
      expect((await owner.archiveBatch.findUniqueOrThrow({ where: { id } })).restoredAt).toBeNull();
      expect((await list("?action=record.restored")).items).toEqual([]);
    });

    it("refuses a kind of record no module brings back", async () => {
      const response = await restore(await openBatch("nobody_knows"));
      expect(response.statusCode).toBe(409);
      expect(response.json<{ code: string }>().code).toBe("restore_unavailable");
    });

    it("answers 404 for a package that is not there, and 400 for something that is not an id", async () => {
      expect((await restore("0192f3f0-0000-7000-8000-000000000001")).statusCode).toBe(404);
      expect((await restore("not-an-id")).statusCode).toBe(400);
    });

    it("refuses a restore from a foreign site", async () => {
      const id = await openBatch();
      const response = await api(app, "POST", `/archive/${id}/restore`, {
        cookie,
        headers: { origin: "https://evil.example" },
      });
      expect(response.statusCode).toBe(403);
      expect(restoreRecords).not.toHaveBeenCalled();
    });
  });

  // П1, with a real refusal from the database: a change must not outlive its line in the journal
  describe("when the journal cannot be written", () => {
    beforeAll(async () => {
      await owner.$executeRaw`
        CREATE FUNCTION test_refuse_journal() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.action IN ('user.profile_updated', 'record.restored') THEN RAISE EXCEPTION 'journal refused'; END IF;
          RETURN NEW;
        END
        $$
      `;
    });

    afterAll(async () => {
      await owner.$executeRaw`DROP FUNCTION test_refuse_journal() CASCADE`;
    });

    beforeEach(async () => {
      await owner.$executeRaw`
        CREATE TRIGGER test_refuse_journal BEFORE INSERT ON activity_events
        FOR EACH ROW EXECUTE FUNCTION test_refuse_journal()
      `;
    });

    const removeTrigger = () => owner.$executeRaw`DROP TRIGGER test_refuse_journal ON activity_events`;

    it("takes the change back and answers with an error", async () => {
      const response = await api(app, "PATCH", "/me", { cookie, payload: { fullName: "Не збережеться" } });
      await removeTrigger();

      expect(response.statusCode).toBe(500);
      const user = await owner.user.findUniqueOrThrow({ where: { id: adminId } });
      expect(user.fullName).toBe("Користувач admin@example.test");
    });

    it("takes a restored package back", async () => {
      const id = await openArchiveBatch(db, SYSTEM_CONTEXT, { entityType: RECORDS, label: "Пакет", itemCount: 1 });
      const response = await api(app, "POST", `/archive/${id}/restore`, {
        cookie,
        headers: { origin: testConfig().appUrl },
      });
      await removeTrigger();

      expect(response.statusCode).toBe(500);
      expect((await owner.archiveBatch.findUniqueOrThrow({ where: { id } })).restoredAt).toBeNull();
    });
  });
});
