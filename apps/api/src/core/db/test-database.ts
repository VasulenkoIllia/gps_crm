import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { APP_ROLE_NAME } from "./app-role.repository.js";
import { createDbClient, type DbClient } from "./client.js";

const LOCAL_ENV_FILE = resolve(import.meta.dirname, "../../../../../.env");
const TEST_DATABASE_SUFFIX = "_test";

// Integration tests migrate and write, so they accept only a database named *_test: a server reached through an SSH
// tunnel looks exactly like the local one, and neither it nor the dev database may ever land here.
export function testDatabaseUrl(): string {
  if (existsSync(LOCAL_ENV_FILE)) process.loadEnvFile(LOCAL_ENV_FILE);
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is not set: integration tests need real PostgreSQL");
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(`TEST_DATABASE_URL must name a *${TEST_DATABASE_SUFFIX} database, not ${name}`);
  }
  return databaseUrl;
}

export function testAppRolePassword(): string {
  testDatabaseUrl();
  const password = process.env.APP_DB_PASSWORD;
  if (!password) throw new Error("APP_DB_PASSWORD is not set: tests connect as the runtime role");
  return password;
}

function failOnPoolError(error: Error): never {
  throw error;
}

// The schema owner: infra/compose.dev.yml locally, a service container in CI. For setting a test up, not for the app.
export function connectTestDatabase(): DbClient {
  return createDbClient(testDatabaseUrl(), failOnPoolError);
}

// What the app itself connects as: every route is tested with the grants production has
export function connectTestAppDatabase(): DbClient {
  const url = new URL(testDatabaseUrl());
  url.username = APP_ROLE_NAME;
  url.password = testAppRolePassword();
  return createDbClient(url.toString(), failOnPoolError);
}
