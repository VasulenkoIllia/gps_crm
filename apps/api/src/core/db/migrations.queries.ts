import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import type { DbClient } from "./client.js";
import type { MigrationRow } from "./migration-state.js";

// $queryRaw only claims a type; raw results are parsed, because a count comes back as bigint and a numeric as Decimal
const migrationRowsSchema = z.array(
  z.object({
    migration_name: z.string(),
    finished_at: z.date().nullable(),
    rolled_back_at: z.date().nullable(),
  }),
);

export async function readMigrationRows(db: DbClient | Prisma.TransactionClient): Promise<MigrationRow[]> {
  const rows = migrationRowsSchema.parse(
    await db.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`,
  );
  return rows.map((row) => ({
    name: row.migration_name,
    isFinished: row.finished_at !== null,
    isRolledBack: row.rolled_back_at !== null,
  }));
}
