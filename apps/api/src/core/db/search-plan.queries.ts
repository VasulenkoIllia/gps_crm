import type { Prisma } from "../../generated/prisma/client.js";
import { CONNECT_TIMEOUT_MS, DB_PROFILES, type DbClient, type DbOrTx } from "./client.js";

// As a list without a search: it runs as long as one statement of the api profile, and waits for a connection a little
// less than the pool would, so that a busy pool ends in the error of a transaction (isTimedOut) every time
const SEARCH_TRANSACTION = { maxWait: CONNECT_TIMEOUT_MS - 1_000, timeout: DB_PROFILES.api.statementTimeoutMs };

// 06-quality.md §6.1, measured on the seed of 1M (D84). A part of a name matches rows that stand together in the order
// of a list (one surname, every «ТОВ ...»), and an index in that order then reads all the rows before them: seconds.
// Without plain index scans PostgreSQL takes the matches by their own index and sorts them, so a search costs as many
// rows as it matches, at worst one pass over the table. For the rest of the transaction only: outside one it would do
// nothing, hence the type.
export async function readMatchesFirst(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT set_config('enable_indexscan', 'off', true)`;
}

// A list or a count with a search; without one it reads as before. The pages of an export go without it: a thousand
// rows a page read in order cost less.
export function withSearchPlan<T>(db: DbClient, q: string | undefined, read: (db: DbOrTx) => Promise<T>): Promise<T> {
  if (!q) return read(db);
  return db.$transaction(async (tx) => {
    await readMatchesFirst(tx);
    return read(tx);
  }, SEARCH_TRANSACTION);
}
