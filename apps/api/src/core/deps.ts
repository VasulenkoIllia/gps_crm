import type { Logger } from "pino";
import type { AppConfig } from "./config.js";
import type { DbClient } from "./db/client.js";
import type { Mailer } from "./email/mailer.js";
import type { JobQueue } from "./jobs/job.js";

// What a module's service needs from the app, built once in main.ts and passed down
export interface AppDeps {
  db: DbClient;
  config: AppConfig;
  mailer: Mailer;
  jobs: JobQueue;
  logger: Pick<Logger, "info" | "warn" | "error">;
}

export const API_PREFIX = "/api/v1";
// The working name until the client names the system (К11)
export const APP_TITLE = "GPS Облік";
// Routes that take a credential, public or not. Fair for an office behind one address, and it caps the hashing a flood
// can cause. The per-account pause of П5 is the real brake.
export const CREDENTIAL_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };
