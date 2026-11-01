import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./core/config.js";
import { createDbClient } from "./core/db/client.js";
import { listExpectedMigrations } from "./core/db/migration-state.js";
import { checkDatabaseReady } from "./core/db/readiness.js";
import { createMailer } from "./core/email/mailer.js";
import { scheduleNightly } from "./core/jobs/nightly.js";
import { createLogger } from "./core/logger.js";
import { installShutdown } from "./core/shutdown.js";
import { runAuthCleanup } from "./modules/auth/index.js";

// Outside the clock change window of 03:00-04:59 (03-data-model.md §3.1)
const AUTH_CLEANUP_HOUR_KYIV = 2;

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
  db,
  config,
  mailer: createMailer(config.smtp),
  webRoot: hasWeb ? webRoot : undefined,
  checkReady: () => checkDatabaseReady(db, expectedMigrations),
});

const stopJobs =
  config.appRole === "api"
    ? () => undefined
    : scheduleNightly(
        AUTH_CLEANUP_HOUR_KYIV,
        async () => logger.info(await runAuthCleanup(db), "auth.cleanup finished"),
        (error) => logger.error({ err: error }, "auth.cleanup failed"),
      );

installShutdown(app, () => {
  stopJobs();
  return db.$disconnect();
});

await app.listen({ host: config.host, port: config.port });
logger.info({ role: config.appRole }, "started");
