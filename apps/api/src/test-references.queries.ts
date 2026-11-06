import type { DbClient } from "./core/db/client.js";

// For the tests only. A trigger keeps a price in force from a DELETE of anyone (D87), and nothing references these
// tables, so they are emptied whole
export async function truncatePriceHistories(owner: DbClient): Promise<void> {
  await owner.$executeRaw`TRUNCATE cost_prices, addon_prices`;
}
