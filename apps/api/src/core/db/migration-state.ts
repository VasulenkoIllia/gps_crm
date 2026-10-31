import { readdirSync } from "node:fs";

export interface MigrationRow {
  name: string;
  isFinished: boolean;
  isRolledBack: boolean;
}

export type MigrationProblem = { kind: "failed" | "pending"; name: string };

// Folder names under prisma/migrations are the migration names Prisma records
export function listExpectedMigrations(migrationsDir: string): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// Only migrations this image ships count. A row it does not know is fine either way: after a code rollback the older
// image runs on the newer schema, and when a release fails on its migration the running version stays up and ready
// (09-devops.md §9.3) while the new image, which ships that migration, is not ready.
export function findMigrationProblem(expected: string[], rows: MigrationRow[]): MigrationProblem | null {
  const failed = rows.find((row) => !row.isFinished && !row.isRolledBack && expected.includes(row.name));
  if (failed) return { kind: "failed", name: failed.name };

  const applied = new Set(rows.filter((row) => row.isFinished && !row.isRolledBack).map((row) => row.name));
  const pending = expected.find((name) => !applied.has(name));
  return pending ? { kind: "pending", name: pending } : null;
}
