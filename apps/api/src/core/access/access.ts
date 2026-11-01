import type { AccessScope, PermissionKey } from "@gps_crm/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ActivityContext, Actor } from "../activity/activity.repository.js";
import { SYSTEM_ACTOR } from "../activity/activity.repository.js";
import type { DbClient } from "../db/client.js";
import { AppError } from "../errors.js";
import { clientIp } from "../http/client-ip.js";
import { readSessionToken } from "../session/session.cookie.js";
import { readAuthContext, type AuthContext } from "../session/session.queries.js";
import type { SessionOrigin } from "../session/session.repository.js";

export type RouteAccess =
  { kind: "public" } | { kind: "authenticated"; beforeTwoFactor: boolean } | { kind: "permission"; key: PermissionKey };

declare module "fastify" {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
    // Goes to the repository as a required argument (access.md П2)
    accessScope: AccessScope | null;
  }
}

export const publicRoute = (): RouteAccess => ({ kind: "public" });
// beforeTwoFactor: open to a person who has yet to set up the mandatory second factor (K2). Only what setting it up
// needs: route-inventory.test.ts lists them.
export const authenticated = (options: { beforeTwoFactor?: boolean } = {}): RouteAccess => ({
  kind: "authenticated",
  beforeTwoFactor: options.beforeTwoFactor ?? false,
});
export const can = (key: PermissionKey): RouteAccess => ({ kind: "permission", key });

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError(401, "unauthorized", "Потрібно увійти в систему");
  return request.auth;
}

// Whose clients a person works with: the manager at the level `own`, nobody in particular at `all`. A required argument
// of every read and write on client data (access.md П2), so a new query cannot forget it.
export interface RecordScope {
  managerId: string | null;
}

// For what the system does on its own account, a restore of a package this person was already let into
export const ALL_RECORDS: RecordScope = { managerId: null };

export function recordScope(request: FastifyRequest): RecordScope {
  const { accessScope } = request;
  // A route with no permission on it has no level to speak of: that is a bug in the route, and it must not show everything
  if (!accessScope) throw new Error("recordScope needs a route with a permission");
  return { managerId: accessScope === "own" ? requireAuth(request).userId : null };
}

function actorOf(request: FastifyRequest): Actor {
  return request.auth ? { kind: "user", id: request.auth.userId } : SYSTEM_ACTOR;
}

export function activityContext(request: FastifyRequest): ActivityContext {
  return { actor: actorOf(request), ip: clientIp(request), requestId: request.id };
}

export function sessionOrigin(request: FastifyRequest): SessionOrigin {
  return { ip: clientIp(request), userAgent: request.headers["user-agent"] ?? null };
}

function authorize(request: FastifyRequest, access: RouteAccess): void {
  if (access.kind === "public") return;
  const auth = requireAuth(request);
  const isHeldForSetup = !auth.twoFactorEnabled && !(access.kind === "authenticated" && access.beforeTwoFactor);
  if (isHeldForSetup) throw new AppError(403, "two_factor_required", "Спершу налаштуйте двофакторний вхід");
  if (access.kind === "permission") {
    const scope = auth.permissions.get(access.key);
    if (!scope) throw new AppError(403, "forbidden", "Недостатньо прав для цієї дії");
    request.accessScope = scope;
  }
}

// One hook decides for every route, so a new route cannot forget it; onRoute refuses one without a declaration.
// A public route reads no session: a login must not pay for a query, and a stale cookie must not get in its way.
export function registerAccessControl(app: FastifyInstance, db: DbClient, isSecure: boolean): void {
  app.decorateRequest("auth", null);
  app.decorateRequest("accessScope", null);

  app.addHook("onRequest", async (request) => {
    const { access } = request.routeOptions.config;
    if (!access) return;
    if (access.kind !== "public") {
      const token = readSessionToken(request, isSecure);
      request.auth = token ? await readAuthContext(db, token) : null;
    }
    authorize(request, access);
  });
}
