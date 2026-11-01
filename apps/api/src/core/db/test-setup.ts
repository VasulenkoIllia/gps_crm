import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { testDatabaseUrl } from "./test-database.js";

const API_ROOT = resolve(import.meta.dirname, "../../..");

// Vitest global setup of the integration project: migrations from zero and the same setup step a deploy runs, behind
// the same guard as the tests. `migrate deploy` creates the database if it is not there yet. The owner's address is set
// and not left out, because Prisma's config would fill the gap from a local .env, which names the working database.
// The first-admin values are cleared, so that .env cannot put an account into a test.
export default function applyMigrations(): void {
  const env = {
    ...process.env,
    DATABASE_URL: testDatabaseUrl(),
    MIGRATION_DATABASE_URL: testDatabaseUrl(),
    FIRST_ADMIN_EMAIL: "",
    FIRST_ADMIN_NAME: "",
    FIRST_ADMIN_PASSWORD: "",
  };
  execFileSync("npm", ["run", "--silent", "db:deploy"], { cwd: API_ROOT, stdio: "inherit", env });
  execFileSync("npm", ["run", "--silent", "db:setup"], { cwd: API_ROOT, stdio: "inherit", env });
}
