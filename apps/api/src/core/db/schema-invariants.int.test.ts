import { MONEY_MAX_KOP } from "@gps_crm/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_ROLE_NAME } from "./app-role.repository.js";
import type { DbClient } from "./client.js";
import { connectTestDatabase } from "./test-database.js";

// Every object Prisma cannot describe is registered here, so a migration that loses one fails the build
const REQUIRED_EXTENSIONS = ["btree_gist", "pg_stat_statements", "pg_trgm"];
// pgboss comes from the setup step and not from a migration
const REQUIRED_SCHEMAS = ["part", "pgboss"];
const REQUIRED_CHECKS = [
  "users_email_lowercase",
  "tariffs_price_kop_range",
  "addon_prices_price_kop_range",
  "cost_prices_cost_kop_range",
  "programs_inactive_in_package",
  "monitoring_servers_inactive_in_package",
  "tariffs_inactive_in_package",
  "addons_inactive_in_package",
  "tracker_models_inactive_in_package",
  "sim_operators_inactive_in_package",
  "sim_plans_inactive_in_package",
  "contractors_inactive_in_package",
  "disconnect_reasons_inactive_in_package",
];
// The migrations' own: activity.partitions adds months after these, so the list is a floor
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
    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining(REQUIRED_PARTITIONS));
    expect(new Set(rows.map((row) => row.schema))).toEqual(new Set(["part"]));
  });

  it("makes partitions through a function that runs as the owner, and only the runtime role may call it", async () => {
    const rows = await db.$queryRaw<{ isDefiner: boolean; callers: string[]; config: string[] }[]>`
      SELECT p.prosecdef AS "isDefiner",
        ARRAY(
          SELECT grantee::regrole::text FROM aclexplode(p.proacl) WHERE privilege_type = 'EXECUTE' AND grantee <> p.proowner
        ) AS callers,
        p.proconfig AS config
      FROM pg_proc p WHERE p.oid = 'public.ensure_activity_partitions(integer)'::regprocedure
    `;
    expect(rows[0]?.isDefiner).toBe(true);
    expect(rows[0]?.callers).toEqual([APP_ROLE_NAME]);
    expect(rows[0]?.config).toEqual(
      expect.arrayContaining(["search_path=pg_catalog, pg_temp", "TimeZone=UTC", "lock_timeout=5s"]),
    );
  });

  it("indexes the journal by client only where there is a client", async () => {
    const rows = await db.$queryRaw<{ definition: string }[]>`
      SELECT indexdef AS definition FROM pg_indexes WHERE indexname = 'activity_events_subscriber_id_occurred_at_id_idx'
    `;
    expect(rows[0]?.definition).toContain("WHERE (subscriber_id IS NOT NULL)");
  });

  it("refuses an email that is not lower-case, whoever writes it", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { key: "manager" } });
    const attempt = db.user.create({ data: { email: "Mixed@Example.test", fullName: "Тест", roleId: role.id } });
    await expect(attempt).rejects.toThrow(/users_email_lowercase/);
  });

  describe("the references, whoever writes the row", () => {
    const NAME_PREFIX = "invariants";

    async function clearRows(): Promise<void> {
      const names = { startsWith: NAME_PREFIX };
      await db.tariff.deleteMany({ where: { nameNorm: names } });
      await db.monitoringServer.deleteMany({ where: { nameNorm: names } });
      await db.addon.deleteMany({ where: { nameNorm: names } });
      await db.program.deleteMany({ where: { nameNorm: names } });
    }

    // At the start as well: a test that failed halfway leaves its unique names behind
    beforeEach(clearRows);
    afterEach(clearRows);

    async function createServer() {
      const [program, other] = await Promise.all([
        db.program.create({ data: { name: "Перша", nameNorm: `${NAME_PREFIX} перша` } }),
        db.program.create({ data: { name: "Друга", nameNorm: `${NAME_PREFIX} друга` } }),
      ]);
      const server = await db.monitoringServer.create({
        data: { programId: program.id, name: "Сервер", nameNorm: `${NAME_PREFIX} сервер` },
      });
      const tariff = {
        serverId: server.id,
        name: "Тариф",
        nameNorm: `${NAME_PREFIX} тариф`,
        billingModel: "month",
        priceKop: 1n,
      } as const;
      return { program, other, server, tariff };
    }

    it("holds a tariff to a server of its own program", async () => {
      const { program, other, server, tariff } = await createServer();

      const foreign = db.tariff.create({ data: { ...tariff, programId: other.id } });
      await expect(foreign).rejects.toThrow(/tariffs_server_id_program_id_fkey|Foreign key/);

      await db.tariff.create({ data: { ...tariff, programId: program.id } });
      const moved = db.monitoringServer.update({ where: { id: server.id }, data: { programId: other.id } });
      await expect(moved).rejects.toThrow(/tariffs_server_id_program_id_fkey|Foreign key/);
    });

    it("keeps every sum above zero and inside what the API can carry", async () => {
      const { program, tariff } = await createServer();
      const addon = await db.addon.create({ data: { name: "Послуга", nameNorm: `${NAME_PREFIX} послуга` } });
      const addonPrice = { addonId: addon.id, validFrom: new Date("2026-01-01") };
      const cost = { subjectType: "addon", subjectId: addon.id, validFrom: new Date("2026-01-01") } as const;

      for (const kop of [0n, BigInt(MONEY_MAX_KOP) + 1n]) {
        await expect(db.tariff.create({ data: { ...tariff, programId: program.id, priceKop: kop } })).rejects.toThrow(
          /tariffs_price_kop_range/,
        );
        await expect(db.addonPrice.create({ data: { ...addonPrice, priceKop: kop } })).rejects.toThrow(
          /addon_prices_price_kop_range/,
        );
        await expect(db.costPrice.create({ data: { ...cost, costKop: kop } })).rejects.toThrow(
          /cost_prices_cost_kop_range/,
        );
      }

      // The same limit as the API's: what it accepts must not end as a 500 here
      const largest = await db.addonPrice.create({ data: { ...addonPrice, priceKop: BigInt(MONEY_MAX_KOP) } });
      await db.addonPrice.delete({ where: { id: largest.id } });
    });

    it("keeps a deactivated record in a package of the archive, the only way back", async () => {
      const lost = db.program.create({
        data: { name: "Без пакета", nameNorm: `${NAME_PREFIX} без пакета`, isActive: false },
      });
      await expect(lost).rejects.toThrow(/programs_inactive_in_package/);
    });
  });

  it("runs on PostgreSQL 18 or newer, which uuidv7() needs", async () => {
    const rows = await db.$queryRaw<{ version: number }[]>`
      SELECT current_setting('server_version_num')::int AS version
    `;
    expect(rows[0]?.version).toBeGreaterThanOrEqual(MIN_SERVER_VERSION);
  });
});
