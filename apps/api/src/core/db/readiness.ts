import type { DbClient } from "./client.js";
import { findMigrationProblem } from "./migration-state.js";
import { readMigrationRows } from "./migrations.queries.js";

// Resolves when the database answers and its migrations match this image; the error says what is wrong
export async function checkDatabaseReady(db: DbClient, expectedMigrations: string[]): Promise<void> {
  const problem = findMigrationProblem(expectedMigrations, await readMigrationRows(db));
  if (problem) throw new Error(`${problem.kind} migration: ${problem.name}`);
}
