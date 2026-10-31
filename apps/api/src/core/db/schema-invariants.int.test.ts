import { afterAll, describe, expect, it } from "vitest";
import type { DbClient } from "./client.js";
import { connectTestDatabase } from "./test-database.js";

// Every object Prisma cannot describe is registered here, so a migration that loses one fails the build
const REQUIRED_EXTENSIONS = ["btree_gist", "pg_stat_statements", "pg_trgm"];
const REQUIRED_SCHEMAS = ["part"];
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

  it("runs on PostgreSQL 18 or newer, which uuidv7() needs", async () => {
    const rows = await db.$queryRaw<{ version: number }[]>`
      SELECT current_setting('server_version_num')::int AS version
    `;
    expect(rows[0]?.version).toBeGreaterThanOrEqual(MIN_SERVER_VERSION);
  });
});
