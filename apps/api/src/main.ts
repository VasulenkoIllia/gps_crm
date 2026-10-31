import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./core/config.js";
import { createDbClient } from "./core/db/client.js";
import { listExpectedMigrations } from "./core/db/migration-state.js";
import { checkDatabaseReady } from "./core/db/readiness.js";
import { createLogger } from "./core/logger.js";
import { installShutdown } from "./core/shutdown.js";

const config = loadConfig(process.env);
const logger = createLogger(config.logLevel);

// The same relative paths from src/ in development and from dist/ in the image
const webRoot = resolve(import.meta.dirname, "../../web/dist");
const migrationsDir = resolve(import.meta.dirname, "../prisma/migrations");

// Production serves the built web app; in development Vite serves it and proxies the API here
const hasWeb = existsSync(webRoot);
if (!hasWeb && config.isProduction) {
  throw new Error(`${webRoot} is missing: the image was built without the web app`);
}

const db = createDbClient(config.databaseUrl, (error) => logger.error({ err: error }, "database pool error"));
const expectedMigrations = listExpectedMigrations(migrationsDir);

const app = await buildApp({
  logger,
  webRoot: hasWeb ? webRoot : undefined,
  checkReady: () => checkDatabaseReady(db, expectedMigrations),
});
installShutdown(app, () => db.$disconnect());

await app.listen({ host: config.host, port: config.port });
// No background jobs exist yet, so every role serves HTTP; APP_ROLE=worker starts mattering with pg-boss (step 2)
logger.info({ role: config.appRole }, "started");
