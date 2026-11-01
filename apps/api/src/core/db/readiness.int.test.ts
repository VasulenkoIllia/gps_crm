import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestApp } from "../test-app.js";
import type { DbClient } from "./client.js";
import { findMigrationProblem, listExpectedMigrations } from "./migration-state.js";
import { readMigrationRows } from "./migrations.queries.js";
import { checkDatabaseReady } from "./readiness.js";
import { connectTestDatabase } from "./test-database.js";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../../prisma/migrations");
const FAILED_MIGRATION = "00000000000000_failed_in_test";

class RollBackTestChanges extends Error {}

describe("database readiness", () => {
  const db: DbClient = connectTestDatabase();
  const expected = listExpectedMigrations(MIGRATIONS_DIR);

  afterAll(() => db.$disconnect());

  it("is ready on a migrated database", async () => {
    const app = await buildTestApp({ checkReady: () => checkDatabaseReady(db, expected) });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("is not ready while a migration of this image is pending", async () => {
    const app = await buildTestApp({
      checkReady: () => checkDatabaseReady(db, [...expected, "99999999999999_pending"]),
    });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("sees a failed migration in the real table", async () => {
    const rollback = db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at)
        VALUES (gen_random_uuid()::text, 'test', ${FAILED_MIGRATION}, now())
      `;
      const problem = findMigrationProblem([...expected, FAILED_MIGRATION], await readMigrationRows(tx));
      expect(problem).toEqual({ kind: "failed", name: FAILED_MIGRATION });
      throw new RollBackTestChanges();
    });
    await expect(rollback).rejects.toBeInstanceOf(RollBackTestChanges);
  });

  it("applies the session timeouts from the pool settings", async () => {
    const rows = await db.$queryRaw<{ statement: string; idleInTransaction: string }[]>`
      SELECT current_setting('statement_timeout') AS statement,
             current_setting('idle_in_transaction_session_timeout') AS "idleInTransaction"
    `;
    expect(rows[0]).toEqual({ statement: "5s", idleInTransaction: "30s" });
  });
});
