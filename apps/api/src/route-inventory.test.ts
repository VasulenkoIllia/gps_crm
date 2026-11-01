import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { finalizeInventory, type RouteRecord } from "./core/access/route-inventory.js";
import { buildTestApp } from "./core/test-app.js";

// `npm run routes:update` accepts a change on purpose: the point of this file is the diff somebody reads
const SNAPSHOT = resolve(import.meta.dirname, "route-inventory.json");
const isUpdating = process.env.UPDATE_ROUTE_INVENTORY === "1";

describe("route inventory", () => {
  let app: FastifyInstance;
  let live: RouteRecord[];

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
    live = finalizeInventory(app.routeInventory);
    if (isUpdating) writeFileSync(SNAPSHOT, `${JSON.stringify(live, null, 2)}\n`);
  });

  afterAll(() => app.close());

  it("matches the committed snapshot", () => {
    const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as RouteRecord[];
    expect(live).toEqual(snapshot);
  });

  it("keeps the public surface to these routes, and any addition is a decision made here", () => {
    const open = live.filter((route) => route.access === "public" && !route.derived);
    expect(open.map((route) => `${route.method} ${route.url}`).sort()).toEqual([
      "GET /health",
      "GET /health/ready",
      "POST /api/v1/auth/2fa",
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/password-reset",
      "POST /api/v1/auth/password-reset/confirm",
      "POST /api/v1/invitations/accept",
    ]);
  });

  it("keeps what a person without 2FA can reach to what setting it up needs", () => {
    const held = live.filter((route) => route.beforeTwoFactor && !route.derived);
    expect(held.map((route) => `${route.method} ${route.url}`).sort()).toEqual([
      "GET /api/v1/me",
      "POST /api/v1/auth/logout",
      "POST /api/v1/me/2fa/confirm",
      "POST /api/v1/me/2fa/setup",
    ]);
  });

  it("stops the server when a route under /api declares no access", async () => {
    const bare = await buildTestApp();
    expect(() => bare.get("/api/v1/undeclared", () => ({}))).toThrow("declares no access");
    await bare.close();
  });
});
