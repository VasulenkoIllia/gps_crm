import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { testDatabaseUrl } from "./test-database.js";

const API_ROOT = resolve(import.meta.dirname, "../../..");

// Vitest global setup of the integration project: migrations from zero, behind the same guard as the tests.
// `migrate deploy` creates the database if it is not there yet.
export default function applyMigrations(): void {
  execFileSync("npm", ["run", "--silent", "db:deploy"], {
    cwd: API_ROOT,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  });
}
