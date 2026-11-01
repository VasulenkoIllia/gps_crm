import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { recordActivity, SYSTEM_ACTOR } from "../activity/activity.repository.js";
import { APP_ROLE_NAME } from "./app-role.repository.js";
import type { DbClient } from "./client.js";
import { listExpectedMigrations } from "./migration-state.js";
import { checkDatabaseReady } from "./readiness.js";
import { connectTestAppDatabase, connectTestDatabase } from "./test-database.js";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../../prisma/migrations");
const PRISMA_TABLES = ["_prisma_migrations"];
const CONTEXT = { actor: SYSTEM_ACTOR, ip: null, requestId: null };
// Any other failure (a typo in the statement, say) would pass a bare rejects.toThrow() and prove nothing
const DENIED = /permission denied|must be owner/;

// 06-quality.md §6.2.10: what the running app can do to the database, if something gets past the code
describe("the runtime role", () => {
  const owner: DbClient = connectTestDatabase();
  const app: DbClient = connectTestAppDatabase();

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("is an ordinary role", async () => {
    const rows = await owner.$queryRaw<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }[]>`
      SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = ${APP_ROLE_NAME}
    `;
    expect(rows).toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false }]);
  });

  it("owns nothing", async () => {
    const rows = await owner.$queryRaw<unknown[]>`
      SELECT 1 FROM pg_tables WHERE tableowner = ${APP_ROLE_NAME}
    `;
    expect(rows).toEqual([]);
  });

  it.each<[string, (db: DbClient) => Promise<number>]>([
    ["create a table", (db) => db.$executeRaw`CREATE TABLE public.stolen (id int)`],
    ["drop a table", (db) => db.$executeRaw`DROP TABLE users`],
    ["add a column", (db) => db.$executeRaw`ALTER TABLE users ADD COLUMN stolen text`],
    ["empty a table", (db) => db.$executeRaw`TRUNCATE sessions`],
    ["reach the migrations", (db) => db.$executeRaw`DELETE FROM _prisma_migrations`],
    ["reach a partition directly", (db) => db.$executeRaw`DELETE FROM part.activity_events_default`],
    ["create a role", (db) => db.$executeRaw`CREATE ROLE stolen`],
  ])("cannot %s", async (_, attempt) => {
    await expect(attempt(app)).rejects.toThrow(DENIED);
  });

  it("passes the readiness check, which reads the table of migrations", async () => {
    await expect(checkDatabaseReady(app, listExpectedMigrations(MIGRATIONS_DIR))).resolves.toBeUndefined();
  });

  it("writes and reads the journal, and cannot change or delete it", async () => {
    await recordActivity(app, CONTEXT, { action: "user.unblocked" });

    expect(await app.activityEvent.count({ where: { action: "user.unblocked" } })).toBeGreaterThan(0);
    await expect(app.activityEvent.updateMany({ data: { action: "x" } })).rejects.toThrow(DENIED);
    await expect(app.activityEvent.deleteMany()).rejects.toThrow(DENIED);
    await owner.activityEvent.deleteMany({ where: { action: "user.unblocked" } });
  });

  it("undoes the change when the journal fails in the same transaction", async () => {
    const email = "rollback@example.test";
    const role = await owner.role.findUniqueOrThrow({ where: { key: "manager" } });
    const attempt = app.$transaction(async (tx) => {
      await tx.user.create({ data: { email, fullName: "Тест", roleId: role.id } });
      await tx.activityEvent.create({ data: { actorKind: "system", action: "x", entityId: "not-a-uuid" } });
    });

    await expect(attempt).rejects.toThrow(/uuid/i);
    expect(await owner.user.count({ where: { email } })).toBe(0);
  });

  it("has DML on every table a module owns, so a new table cannot miss its grant", async () => {
    const rows = await owner.$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
        AND NOT (has_table_privilege(${APP_ROLE_NAME}, c.oid, 'SELECT')
             AND has_table_privilege(${APP_ROLE_NAME}, c.oid, 'INSERT'))
    `;
    expect(rows.map((row) => row.table_name)).toEqual(PRISMA_TABLES);
  });
});
