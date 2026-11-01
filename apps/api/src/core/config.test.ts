import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const DATABASE_URL = "postgresql://user:s3cret@127.0.0.1:5432/app";
const SECRETS_KEY = Buffer.alloc(32, 1).toString("base64");
const BASE = { DATABASE_URL, SECRETS_KEY };

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig(BASE)).toEqual({
      isProduction: false,
      appRole: "all",
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
      databaseUrl: DATABASE_URL,
      appUrl: "http://localhost:5173",
      secretsKey: Buffer.alloc(32, 1),
      smtp: null,
    });
  });

  it("treats empty values as missing", () => {
    expect(loadConfig({ ...BASE, PORT: "", APP_ROLE: "", LOG_LEVEL: "" })).toMatchObject({
      port: 3000,
      appRole: "all",
      logLevel: "info",
    });
  });

  it.each(["all", "api", "worker"])("accepts APP_ROLE=%s", (role) => {
    expect(loadConfig({ ...BASE, APP_ROLE: role }).appRole).toBe(role);
  });

  it("names the broken variable", () => {
    expect(() => loadConfig({ ...BASE, APP_ROLE: "cron" })).toThrow(/APP_ROLE/);
    expect(() => loadConfig({ ...BASE, PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ SECRETS_KEY })).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres url without printing it", () => {
    let message = "";
    try {
      loadConfig({ SECRETS_KEY, DATABASE_URL: "mysql://user:s3cret@127.0.0.1/app" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("s3cret");
  });

  it("refuses a short key without printing it", () => {
    let message = "";
    try {
      loadConfig({ DATABASE_URL, SECRETS_KEY: "c2hvcnQta2V5" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("SECRETS_KEY");
    expect(message).not.toContain("c2hvcnQta2V5");
  });

  it("needs the address of the app in production", () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: "production" })).toThrow(/APP_URL/);
    expect(loadConfig({ ...BASE, NODE_ENV: "production", APP_URL: "https://app.example.test/" }).appUrl).toBe(
      "https://app.example.test",
    );
  });

  it("reads SMTP as one group", () => {
    const smtp = { SMTP_HOST: "mail.example.test", SMTP_FROM: "GPS <crm@example.test>" };
    expect(loadConfig({ ...BASE, ...smtp }).smtp).toEqual({
      host: "mail.example.test",
      port: 587,
      from: "GPS <crm@example.test>",
      auth: null,
    });
    expect(() => loadConfig({ ...BASE, SMTP_HOST: "mail.example.test" })).toThrow(/SMTP_FROM/);
    expect(() => loadConfig({ ...BASE, ...smtp, SMTP_USER: "crm" })).toThrow(/SMTP_PASSWORD/);
  });
});
