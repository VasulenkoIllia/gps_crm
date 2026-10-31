import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const DATABASE_URL = "postgresql://user:s3cret@127.0.0.1:5432/app";

describe("loadConfig", () => {
  it("applies defaults", () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      isProduction: false,
      appRole: "all",
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
      databaseUrl: DATABASE_URL,
    });
  });

  it("treats empty values as missing", () => {
    expect(loadConfig({ DATABASE_URL, PORT: "", APP_ROLE: "", LOG_LEVEL: "" })).toMatchObject({
      port: 3000,
      appRole: "all",
      logLevel: "info",
    });
  });

  it.each(["all", "api", "worker"])("accepts APP_ROLE=%s", (role) => {
    expect(loadConfig({ DATABASE_URL, APP_ROLE: role }).appRole).toBe(role);
  });

  it("names the broken variable", () => {
    expect(() => loadConfig({ DATABASE_URL, APP_ROLE: "cron" })).toThrow(/APP_ROLE/);
    expect(() => loadConfig({ DATABASE_URL, PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejects a non-postgres url without printing it", () => {
    let message = "";
    try {
      loadConfig({ DATABASE_URL: "mysql://user:s3cret@127.0.0.1/app" });
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("s3cret");
  });
});
