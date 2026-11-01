import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppError } from "./core/errors.js";
import { READY_TIMEOUT_MS } from "./core/http/health.js";
import { createLogger } from "./core/logger.js";
import { buildTestApp } from "./core/test-app.js";

const READY = () => Promise.resolve();
const NOT_READY = () => Promise.reject(new Error("pending migration: x"));

describe("health", () => {
  it("answers /health without touching the readiness check", async () => {
    const app = await buildTestApp({ checkReady: NOT_READY });
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("answers /health/ready with 200 when ready", async () => {
    const app = await buildTestApp({ checkReady: READY });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("answers /health/ready with 503 and no reason when not ready", async () => {
    const app = await buildTestApp({ checkReady: NOT_READY });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    await app.close();
  });

  it("asks the database once for a burst of /health/ready", async () => {
    const checkReady = vi.fn(READY);
    const app = await buildTestApp({ checkReady });
    await Promise.all([1, 2, 3].map(() => app.inject({ method: "GET", url: "/health/ready" })));
    expect(checkReady).toHaveBeenCalledOnce();
    await app.close();
  });

  it("does not let a hanging check hold /health/ready", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const app = await buildTestApp({ checkReady: () => new Promise(() => undefined) });
    const pending = app.inject({ method: "GET", url: "/health/ready" });
    await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS);
    vi.useRealTimers();
    expect((await pending).statusCode).toBe(503);
    await app.close();
  });
});

describe("errors", () => {
  it("answers 500 in the common format without the details", async () => {
    const app = await buildTestApp({ checkReady: READY });
    app.get("/boom", () => {
      throw new Error("database password rejected");
    });
    const response = await app.inject({ method: "GET", url: "/boom" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: "internal_error" });
    expect(response.body).not.toContain("password");
    await app.close();
  });

  it("sends an AppError as it is", async () => {
    const app = await buildTestApp({ checkReady: READY });
    app.get("/taken", () => {
      throw new AppError(409, "code_taken", "Такий ID уже є", { code: "Такий ID уже є" });
    });
    const response = await app.inject({ method: "GET", url: "/taken" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "code_taken",
      message: "Такий ID уже є",
      fieldErrors: { code: "Такий ID уже є" },
    });
    await app.close();
  });

  it("sends the code and the text of an AppError with a 5xx status", async () => {
    const app = await buildTestApp({ checkReady: READY });
    app.get("/mail", () => {
      throw new AppError(503, "integration_unavailable", "Пошта тимчасово не працює");
    });
    const response = await app.inject({ method: "GET", url: "/mail" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "integration_unavailable", message: "Пошта тимчасово не працює" });
    await app.close();
  });

  it("answers a failed schema check with validation_failed and the fields", async () => {
    const app = await buildTestApp({ checkReady: READY });
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
    app.post("/items", { schema: { body: schema } }, () => ({}));
    const response = await app.inject({ method: "POST", url: "/items", payload: {} });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ code: string; fieldErrors: Record<string, string> }>();
    expect(body.code).toBe("validation_failed");
    expect(Object.keys(body.fieldErrors)).toEqual(["name"]);
    await app.close();
  });

  it("keeps the status of a library error but not its message", async () => {
    const app = await buildTestApp({ checkReady: READY });
    app.get("/denied", () => {
      throw Object.assign(new Error("GET https://api.example.test/?key=k123 failed"), { statusCode: 403 });
    });
    const response = await app.inject({ method: "GET", url: "/denied" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "forbidden" });
    expect(response.body).not.toContain("k123");
    await app.close();
  });

  // 599 is the last status Fastify can send: a library status above it becomes a 500
  it.each([
    [599, 599],
    [600, 500],
  ])("answers a library status %i with %i", async (thrown, sent) => {
    const app = await buildTestApp({ checkReady: READY });
    app.get("/upstream", () => {
      throw Object.assign(new Error(`upstream answered ${thrown}`), { statusCode: thrown });
    });
    const response = await app.inject({ method: "GET", url: "/upstream" });
    expect(response.statusCode).toBe(sent);
    expect(response.json()).toMatchObject({ code: "internal_error" });
    await app.close();
  });

  it("answers broken JSON with 400 in the common format", async () => {
    const app = await buildTestApp({ checkReady: READY });
    app.post("/echo", (request) => request.body);
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: "{broken",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "bad_request" });
    await app.close();
  });

  it("answers 404 in the common format", async () => {
    const app = await buildTestApp({ checkReady: READY });
    const response = await app.inject({ method: "GET", url: "/api/v1/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: "not_found" });
    await app.close();
  });
});

describe("request log", () => {
  it("logs the path without its query and without headers", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = await buildTestApp({ checkReady: READY, logger: createLogger("info", stream) });
    await app.inject({
      method: "GET",
      url: "/orders?token=query-secret",
      headers: { cookie: "session=cookie-secret" },
    });
    await app.close();

    const log = lines.join("");
    expect(log).toContain('"url":"/orders"');
    expect(log).not.toContain("query-secret");
    expect(log).not.toContain("cookie-secret");
  });

  it("keeps the arguments of a failed database query out of the log", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const app = await buildTestApp({ checkReady: READY, logger: createLogger("info", stream) });
    app.get("/payers", () => {
      throw Object.assign(new Error("Invalid invocation: { iban: 'UA213223130000026007233566001' }"), {
        name: "PrismaClientKnownRequestError",
        code: "P2002",
      });
    });
    await app.inject({ method: "GET", url: "/payers" });
    await app.close();

    const log = lines.join("");
    expect(log).toContain("P2002");
    expect(log).not.toContain("UA2132");
  });
});

describe("security headers", () => {
  it("sets the policy on API answers", async () => {
    const app = await buildTestApp({ checkReady: READY });
    const { headers } = await app.inject({ method: "GET", url: "/health" });
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    await app.close();
  });
});

describe("web app", () => {
  const webRoot = mkdtempSync(join(tmpdir(), "web-"));
  writeFileSync(join(webRoot, "index.html"), '<div id="root"></div>');
  writeFileSync(join(webRoot, ".secret"), "hidden-file-content");
  mkdirSync(join(webRoot, "assets"));
  writeFileSync(join(webRoot, "assets", "app-1a2b.js"), "export {};");
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    app = await buildTestApp({ checkReady: READY, webRoot });
  });

  afterAll(async () => {
    await app.close();
    rmSync(webRoot, { recursive: true });
  });

  it.each(["/", "/subscribers/42", "/login?next=https://example.test/report.pdf"])(
    "serves the page for %s with the security headers",
    async (url) => {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('id="root"');
      expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    },
  );

  it.each(["/api", "/api/missing?x=1", "/assets/missing.js"])("answers 404 for %s", async (url) => {
    const response = await app.inject({ method: "GET", url });
    expect(response.statusCode).toBe(404);
  });

  it("does not turn a POST to an unknown path into the page", async () => {
    const response = await app.inject({ method: "POST", url: "/subscribers" });
    expect(response.statusCode).toBe(404);
  });

  it("caches hashed assets for good", async () => {
    const response = await app.inject({ method: "GET", url: "/assets/app-1a2b.js" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toContain("immutable");
  });

  it("never serves hidden files", async () => {
    const response = await app.inject({ method: "GET", url: "/.secret" });
    expect(response.body).not.toContain("hidden-file-content");
  });

  it("keeps health routes ahead of the page", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ status: "ok" });
  });
});
