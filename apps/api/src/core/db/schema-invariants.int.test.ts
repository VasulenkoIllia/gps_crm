import { afterAll, describe, expect, it } from "vitest";
import type { DbClient } from "./client.js";
import { connectTestDatabase } from "./test-database.js";

// Every object Prisma cannot describe is registered here, so a migration that loses one fails the build
const REQUIRED_EXTENSIONS = ["btree_gist", "pg_stat_statements", "pg_trgm"];
const REQUIRED_SCHEMAS = ["part"];
const REQUIRED_CHECKS = ["users_email_lowercase"];
const REQUIRED_PARTITIONS = [
  "activity_events_2026_11",
  "activity_events_2026_12",
  "activity_events_2027_01",
  "activity_events_default",
];
const MIN_SERVER_VERSION = 180000;

describe("schema invariants", () => {
  const db: DbClient = connectTestDatabase();

  afterAll(() => db.$disconnect());

  it.each(REQUIRED_EXTENSIONS)("has extension %s", async (extension) => {
    const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_extension WHERE extname = ${extension}`;
    expect(rows).toHaveLength(1);
  });

  it.each(REQUIRED_SCHEMAS)("has schema %s", async (schema) => {
    const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_namespace WHERE nspname = ${schema}`;
    expect(rows).toHaveLength(1);
  });

  it.each(REQUIRED_CHECKS)("has check constraint %s", async (name) => {
    const rows = await db.$queryRaw<unknown[]>`SELECT 1 FROM pg_constraint WHERE conname = ${name} AND contype = 'c'`;
    expect(rows).toHaveLength(1);
  });

  it("keeps the journal partitioned, with its partitions in schema part", async () => {
    const rows = await db.$queryRaw<{ name: string; schema: string }[]>`
      SELECT child.relname AS name, child.relnamespace::regnamespace::text AS schema
      FROM pg_inherits
      JOIN pg_class child ON child.oid = pg_inherits.inhrelid
      WHERE pg_inherits.inhparent = 'public.activity_events'::regclass
      ORDER BY child.relname
    `;
    expect(rows.map((row) => row.name)).toEqual(REQUIRED_PARTITIONS);
    expect(new Set(rows.map((row) => row.schema))).toEqual(new Set(["part"]));
  });

  it("refuses an email that is not lower-case, whoever writes it", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { key: "manager" } });
    const attempt = db.user.create({ data: { email: "Mixed@Example.test", fullName: "Тест", roleId: role.id } });
    await expect(attempt).rejects.toThrow(/users_email_lowercase/);
  });

  it("runs on PostgreSQL 18 or newer, which uuidv7() needs", async () => {
    const rows = await db.$queryRaw<{ version: number }[]>`
      SELECT current_setting('server_version_num')::int AS version
    `;
    expect(rows[0]?.version).toBeGreaterThanOrEqual(MIN_SERVER_VERSION);
  });
});
