import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Two copies of the built app on one database: the same app with mail and without it (D12)
export const WITH_MAIL_URL = "http://localhost:3198";
export const NO_MAIL_URL = "http://localhost:3197";
const BACKUP_STATUS_DIR = join(import.meta.dirname, ".tmp/backup-status");

const SERVER_START_TIMEOUT_MS = 90_000;
const TEST_TIMEOUT_MS = 120_000;

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: see .env.example`);
  return value;
};

const runtimeDatabaseUrl = (): string => {
  const url = new URL(requireEnv("E2E_DATABASE_URL"));
  url.username = "gps_crm_app";
  url.password = requireEnv("APP_DB_PASSWORD");
  return url.toString();
};

// Production settings on purpose: __Host- cookie, Secure, CSP and the built bundle are what a person gets
const serverEnv = (url: string): Record<string, string> => ({
  NODE_ENV: "production",
  LOG_LEVEL: "warn",
  HOST: "127.0.0.1",
  PORT: new URL(url).port,
  APP_URL: url,
  DATABASE_URL: runtimeDatabaseUrl(),
  SECRETS_KEY: requireEnv("SECRETS_KEY"),
  APP_VERSION: "sha-e2e",
  BACKUP_STATUS_DIR,
});

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  testDir: "e2e",
  outputDir: ".tmp/playwright",
  workers: 1,
  fullyParallel: false,
  timeout: TEST_TIMEOUT_MS,
  reporter: "line",
  use: { ...devices["Desktop Chrome"], baseURL: WITH_MAIL_URL, locale: "uk-UA", trace: "retain-on-failure" },
  webServer: [
    {
      command: "bash e2e/start-server.sh",
      url: `${WITH_MAIL_URL}/health`,
      timeout: SERVER_START_TIMEOUT_MS,
      stdout: "pipe",
      env: {
        ...serverEnv(WITH_MAIL_URL),
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: requireEnv("E2E_SMTP_PORT"),
        SMTP_FROM: "GPS Облік <crm@example.test>",
      },
    },
    {
      command: "node dist/main.js",
      cwd: "apps/api",
      url: `${NO_MAIL_URL}/health`,
      timeout: SERVER_START_TIMEOUT_MS,
      env: serverEnv(NO_MAIL_URL),
    },
  ],
});
