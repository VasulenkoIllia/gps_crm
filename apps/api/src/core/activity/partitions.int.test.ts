import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client.js";
import type { DbClient } from "../db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../db/test-database.js";
import { ACTIVITY_MONTHS_AHEAD, ensureActivityPartitions } from "./activity.repository.js";

const DENIED = /permission denied/;

// Year and month of a month counted from this one, in UTC, the way the function names and bounds its partitions
function monthAhead(offset: number): { name: string; start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  const month = String(start.getUTCMonth() + 1).padStart(2, "0");
  return {
    name: `activity_events_${start.getUTCFullYear()}_${month}`,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

// activity.md П6: the runtime role cannot make a partition itself, so these run as it
describe("activity.partitions", () => {
  const owner: DbClient = connectTestDatabase();
  const app: DbClient = connectTestAppDatabase();
  const last = monthAhead(ACTIVITY_MONTHS_AHEAD);

  async function partitionNames(): Promise<string[]> {
    const rows = await owner.$queryRaw<{ name: string }[]>`
      SELECT child.relname AS name FROM pg_inherits i
      JOIN pg_class child ON child.oid = i.inhrelid
      WHERE i.inhparent = 'public.activity_events'::regclass
    `;
    return rows.map((row) => row.name);
  }

  async function dropLastPartition(): Promise<void> {
    await owner.activityEvent.deleteMany({ where: { action: "user.unblocked" } });
    await owner.$executeRaw(Prisma.raw(`DROP TABLE IF EXISTS part.${last.name}`));
  }

  beforeEach(dropLastPartition);

  afterAll(async () => {
    await dropLastPartition();
    await ensureActivityPartitions(owner);
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("creates the month in hand and three ahead, and a repeat changes nothing", async () => {
    expect((await ensureActivityPartitions(app)).created).toBeGreaterThanOrEqual(1);

    const names = await partitionNames();
    for (let offset = 0; offset <= ACTIVITY_MONTHS_AHEAD; offset += 1) {
      expect(names).toContain(monthAhead(offset).name);
    }
    expect((await ensureActivityPartitions(app)).created).toBe(0);
  });

  it("sets the bounds in UTC whatever zone the session is in", async () => {
    await app.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Europe/Kyiv'`;
      await ensureActivityPartitions(tx);
    });

    const rows = await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      return tx.$queryRaw<{ bound: string }[]>`
        SELECT pg_get_expr(c.relpartbound, c.oid) AS bound FROM pg_class c
        WHERE c.relnamespace = 'part'::regnamespace AND c.relname = ${last.name}
      `;
    });
    const day = (moment: string) => moment.slice(0, 10);
    expect(rows[0]?.bound).toBe(
      `FOR VALUES FROM ('${day(last.start)} 00:00:00+00') TO ('${day(last.end)} 00:00:00+00')`,
    );
  });

  it("survives two callers at once: the second finds the table made and makes nothing", async () => {
    const answers = await Promise.all([ensureActivityPartitions(app), ensureActivityPartitions(app)]);
    expect(answers.map(({ created }) => created).sort()).toEqual([0, 1]);
  });

  it("says how many rows stay stranded in the default partition", async () => {
    const lost = new Date("2020-01-15T00:00:00Z");
    await app.activityEvent.create({ data: { occurredAt: lost, actorKind: "system", action: "user.unblocked" } });

    expect((await ensureActivityPartitions(app)).stranded).toBe(1);

    await owner.$executeRaw`DELETE FROM part.activity_events_default WHERE occurred_at = ${lost}`;
    expect((await ensureActivityPartitions(app)).stranded).toBe(0);
  });

  it("takes in the rows that landed in the default partition while the month had none", async () => {
    const moment = new Date(last.start);
    await app.activityEvent.create({ data: { occurredAt: moment, actorKind: "system", action: "user.unblocked" } });
    const inDefault = () => owner.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM part.activity_events_default WHERE action = 'user.unblocked'
    `;
    expect((await inDefault())[0]?.count).toBe(1n);

    await ensureActivityPartitions(app);

    expect((await inDefault())[0]?.count).toBe(0n);
    expect(await app.activityEvent.count({ where: { action: "user.unblocked" } })).toBe(1);
  });

  it("gives a new partition to the owner and no grant to the runtime role", async () => {
    await ensureActivityPartitions(app);

    const rows = await owner.$queryRaw<{ isOwnedByRole: boolean }[]>`
      SELECT pg_get_userbyid(c.relowner) = current_user AS "isOwnedByRole" FROM pg_class c
      WHERE c.relnamespace = 'part'::regnamespace AND c.relname = ${last.name}
    `;
    expect(rows).toEqual([{ isOwnedByRole: true }]);
    await expect(app.$executeRaw(Prisma.raw(`DELETE FROM part.${last.name}`))).rejects.toThrow(DENIED);
  });

  it("carries the indexes of the journal to a new partition", async () => {
    await ensureActivityPartitions(app);

    const rows = await owner.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM pg_inherits i
      JOIN pg_class child ON child.oid = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE parent.relname LIKE 'activity_events%' AND parent.relkind = 'I' AND child.relname LIKE ${`${last.name}%`}
    `;
    const parents = await owner.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'activity_events'
    `;
    expect(rows[0]?.count).toBe(parents[0]?.count);
  });

  it.each([0, 13])("refuses %i months ahead", async (months) => {
    await expect(ensureActivityPartitions(app, months)).rejects.toThrow();
  });
});
