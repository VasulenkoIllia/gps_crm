import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppOptions } from "../app.js";
import type { AppConfig } from "./config.js";
import { createDbClient } from "./db/client.js";
import type { MailMessage, Mailer } from "./email/mailer.js";
import type { FileStorage } from "./files/file-storage.js";
import type { JobQueue } from "./jobs/job.js";

const SECRETS_KEY_BYTES = 32;
const SECRETS_KEY_FILL = 7;
const UNREACHABLE_DATABASE = "postgresql://nobody:nothing@127.0.0.1:1/none";

export const TEST_APP_URL = "http://app.test";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    isProduction: false,
    appRole: "all",
    host: "127.0.0.1",
    port: 3000,
    logLevel: "silent",
    databaseUrl: UNREACHABLE_DATABASE,
    appUrl: TEST_APP_URL,
    secretsKey: Buffer.alloc(SECRETS_KEY_BYTES, SECRETS_KEY_FILL),
    appVersion: null,
    backupStatusDir: null,
    files: { storage: "local", dir: join(tmpdir(), "gps_crm-test-files") },
    crmUrl: null,
    smtp: null,
    ...overrides,
  };
}

export interface CapturingMailer extends Mailer {
  sent: MailMessage[];
}

export function captureMailer(): CapturingMailer {
  const sent: MailMessage[] = [];
  return {
    sent,
    isConfigured: true,
    send: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

export const NO_MAIL: Mailer = {
  isConfigured: false,
  send: () => Promise.reject(new Error("mail is not configured in this test")),
};

export const NO_JOBS: JobQueue = {
  definitions: [],
  requestRun: () => Promise.reject(new Error("jobs are not running in this test")),
  readQueues: () => Promise.resolve([]),
  lastErrorAt: () => null,
};

export const NO_FILES: FileStorage = {
  name: "none",
  prepare: () => Promise.resolve(),
  put: () => Promise.reject(new Error("files are not stored in this test")),
  read: () => Promise.resolve(null),
  remove: () => Promise.resolve(),
};

// A database client that never connects: unit tests stay away from the routes that would need it
export function buildTestApp(options: Partial<AppOptions> = {}): Promise<FastifyInstance> {
  return buildApp({
    checkReady: () => Promise.resolve(),
    config: testConfig(),
    mailer: NO_MAIL,
    jobs: NO_JOBS,
    db: createDbClient(UNREACHABLE_DATABASE, () => undefined),
    ...options,
  });
}
