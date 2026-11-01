import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./core/config.js";
import { createDbClient, DB_PROFILES } from "./core/db/client.js";
import { listExpectedMigrations } from "./core/db/migration-state.js";
import { checkDatabaseReady } from "./core/db/readiness.js";
import { createMailer } from "./core/email/mailer.js";
import { createJobQueue } from "./core/jobs/queue.js";
import { createLogger } from "./core/logger.js";
import { installShutdown } from "./core/shutdown.js";
import { JOBS } from "./jobs.js";
import { noteDeployment } from "./modules/system/index.js";

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

const onPoolError = (error: Error) => logger.error({ err: error }, "database pool error");
const db = createDbClient(config.databaseUrl, onPoolError);
const jobsDb = createDbClient(config.databaseUrl, onPoolError, DB_PROFILES.worker);
const expectedMigrations = listExpectedMigrations(migrationsDir);
const jobs = createJobQueue({
  connectionString: config.databaseUrl,
  role: config.appRole,
  definitions: JOBS,
  db: jobsDb,
  logger,
});

async function checkReady(): Promise<void> {
  await checkDatabaseReady(db, expectedMigrations);
  if (!jobs.isStarted()) throw new Error("the job queue is not running");
}

const app = await buildApp({
  logger,
  db,
  config,
  mailer: createMailer(config.smtp),
  jobs,
  webRoot: hasWeb ? webRoot : undefined,
  checkReady,
});

installShutdown(app, async () => {
  await jobs.stop();
  await jobsDb.$disconnect();
  await db.$disconnect();
});

// HTTP first (02-architecture.md §2.4): /health answers while the queue connects, and /health/ready holds the traffic.
await app.listen({ host: config.host, port: config.port });
logger.info({ role: config.appRole }, "started");

// An error here ends the process through the handlers of installShutdown: Docker restarts it, a deploy rolls back
await jobs.start();
logger.info("job queue started");

// A failed record costs one line of the journal and must not stop a working version
if (config.appVersion && config.appRole !== "worker") {
  await noteDeployment(db, config.appVersion).catch((error: unknown) => {
    logger.error({ err: error }, "could not record the deployment");
  });
}
