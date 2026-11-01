import { ACCESS_SCOPE, PERMISSION_KEYS, ROLE_KEYS, ROLES, type RoleKey } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { finalizeInventory } from "../../core/access/route-inventory.js";
import { NO_MAIL, testConfig } from "../../core/test-app.js";
import { api, clearAuthData, createUser, signInWithSetup } from "../../test-auth.js";

const ZERO_ID = "019a0000-0000-7000-8000-000000000000";

describe("the role seed", () => {
  const owner: DbClient = connectTestDatabase();

  afterAll(() => owner.$disconnect());

  it("has exactly the roles of the registry", async () => {
    const rows = await owner.role.findMany({ orderBy: { key: "asc" } });
    expect(rows.map(({ key, name }) => [key, name])).toEqual(
      [...ROLE_KEYS].sort().map((key) => [key, ROLES[key].name]),
    );
  });

  it("gives every role every permission of the registry at level `all` (D14)", async () => {
    const rows = await owner.rolePermission.findMany({ include: { role: true } });
    const pairs = rows.map((row) => `${row.role.key}:${row.key}:${row.scope}`).sort();
    const expected = ROLE_KEYS.flatMap((role) => PERMISSION_KEYS.map((key) => `${role}:${key}:${ACCESS_SCOPE.all}`));
    expect(pairs).toEqual(expected.sort());
  });
});

describe("the route × role matrix (stage 1: everything is allowed, D14)", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let app: FastifyInstance;
  const cookies = new Map<RoleKey, string>();

  beforeAll(async () => {
    await clearAuthData(owner);
    app = await buildApp({ db, config: testConfig(), mailer: NO_MAIL, checkReady: () => Promise.resolve() });
    await app.ready();
    for (const roleKey of ROLE_KEYS) {
      const user = await createUser(owner, { email: `${roleKey}@example.test`, roleKey });
      const { cookie } = await signInWithSetup(app, owner, user);
      cookies.set(roleKey, cookie);
    }
  });

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  const permissionRoutes = () =>
    finalizeInventory(app.routeInventory).filter((route) => route.access.startsWith("can:") && !route.derived);
  const protectedRoutes = () =>
    finalizeInventory(app.routeInventory).filter((route) => route.access !== "public" && !route.derived);

  it.each(ROLE_KEYS)("lets %s through every declared permission", async (roleKey) => {
    for (const route of permissionRoutes()) {
      const url = route.url.replace("/api/v1", "").replace(":id", ZERO_ID);
      const answer = await api(app, route.method, url, { cookie: cookies.get(roleKey), payload: {} });
      expect([401, 403], `${route.method} ${route.url}`).not.toContain(answer.statusCode);
      expect(answer.statusCode, `${route.method} ${route.url}`).toBeLessThan(500);
    }
  });

  it("closes every non-public route to a request without a session", async () => {
    for (const route of protectedRoutes()) {
      const url = route.url.replace("/api/v1", "").replace(":id", ZERO_ID);
      const answer = await api(app, route.method, url);
      expect(answer.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it("refuses a role that lost a permission, with the text of the module doc", async () => {
    const role = await owner.role.findUniqueOrThrow({ where: { key: "technician" } });
    await owner.rolePermission.delete({ where: { roleId_key: { roleId: role.id, key: "users.manage" } } });

    const denied = await api(app, "GET", "/users", { cookie: cookies.get("technician") });

    await owner.rolePermission.create({ data: { roleId: role.id, key: "users.manage", scope: "all" } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ code: "forbidden", message: "Недостатньо прав для цієї дії" });
  });

  it("tells the web app what the person may do", async () => {
    const answer = await api(app, "GET", "/me/permissions", { cookie: cookies.get("manager") });

    const { permissions } = answer.json<{ permissions: { key: string; scope: string }[] }>();
    expect(permissions.map((permission) => permission.key).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(new Set(permissions.map((permission) => permission.scope))).toEqual(new Set([ACCESS_SCOPE.all]));
  });
});
