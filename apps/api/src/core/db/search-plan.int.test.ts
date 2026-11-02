import { afterAll, describe, expect, it } from "vitest";
import { DB_PROFILES, type DbOrTx } from "./client.js";
import { withSearchPlan } from "./search-plan.queries.js";
import { connectTestAppDatabase } from "./test-database.js";

// One connection: whatever a search left on it, the next request would get
const ONE_CONNECTION = { ...DB_PROFILES.api, maxConnections: 1 };

async function readIndexScans(db: DbOrTx): Promise<string | undefined> {
  const [row] = await db.$queryRaw<{ setting: string }[]>`SELECT current_setting('enable_indexscan') AS setting`;
  return row?.setting;
}

describe("a search that reads its matches first", () => {
  const db = connectTestAppDatabase(ONE_CONNECTION);

  afterAll(() => db.$disconnect());

  it("reads without plain index scans", async () => {
    expect(await withSearchPlan(db, "ков", readIndexScans)).toBe("off");
  });

  it("reads a list without a search as before", async () => {
    expect(await withSearchPlan(db, undefined, readIndexScans)).toBe("on");
  });

  it("leaves the connection of the pool as it was", async () => {
    await withSearchPlan(db, "ков", readIndexScans);
    expect(await readIndexScans(db)).toBe("on");
  });

  it("leaves it as it was after a failed read too", async () => {
    const failed = withSearchPlan(db, "ков", async (tx) => {
      await readIndexScans(tx);
      throw new Error("read failed");
    });
    await expect(failed).rejects.toThrow("read failed");
    expect(await readIndexScans(db)).toBe("on");
  });
});
