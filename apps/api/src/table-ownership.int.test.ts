import { afterAll, describe, expect, it } from "vitest";
import type { DbClient } from "./core/db/client.js";
import { connectTestDatabase } from "./core/db/test-database.js";
import { OWNED_TABLES as ACCESS_TABLES } from "./modules/access/index.js";
import { OWNED_TABLES as ACTIVITY_TABLES } from "./modules/activity/index.js";
import { OWNED_TABLES as AUTH_TABLES } from "./modules/auth/index.js";
import { OWNED_TABLES as REFERENCES_TABLES } from "./modules/references/index.js";
import { OWNED_TABLES as SUBSCRIBERS_TABLES } from "./modules/subscribers/index.js";
import { OWNED_TABLES as SYSTEM_TABLES } from "./modules/system/index.js";
import { OWNED_TABLES as TWO_FACTOR_TABLES } from "./modules/two-factor/index.js";
import { OWNED_TABLES as USERS_TABLES } from "./modules/users/index.js";

const CORE_TABLES = [
  "sessions",
  "sign_in_throttle",
  "activity_events",
  "job_health",
  "job_events",
  "files",
  "_prisma_migrations",
];

// 02-architecture.md: a table belongs to one module, and a new one has to be claimed here
describe("table ownership", () => {
  const owner: DbClient = connectTestDatabase();

  afterAll(() => owner.$disconnect());

  it("gives every table exactly one owner", async () => {
    const rows = await owner.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const declared = [
      ...ACCESS_TABLES,
      ...ACTIVITY_TABLES,
      ...AUTH_TABLES,
      ...REFERENCES_TABLES,
      ...SUBSCRIBERS_TABLES,
      ...SYSTEM_TABLES,
      ...TWO_FACTOR_TABLES,
      ...USERS_TABLES,
      ...CORE_TABLES,
    ];
    expect(new Set(declared).size).toBe(declared.length);
    expect(rows.map((row) => row.tablename).sort()).toEqual(declared.sort());
  });
});
