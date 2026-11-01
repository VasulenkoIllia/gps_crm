import type { FastifyInstance } from "fastify";
import type { RouteAccess } from "./access.js";

export interface RouteRecord {
  method: string;
  url: string;
  access: string;
  beforeTwoFactor?: true;
  // The HEAD Fastify adds beside every GET: recorded, because it reaches the access hook
  derived?: true;
}

declare module "fastify" {
  interface FastifyInstance {
    routeInventory: RouteRecord[];
  }
}

function describeAccess(access: RouteAccess): string {
  return access.kind === "permission" ? `can:${access.key}` : access.kind;
}

// Must run before any route is registered: onRoute sees only what comes after it. access.md П1: a route under /api
// without a declaration stops the server, so a new route is closed by default.
export function collectRouteInventory(app: FastifyInstance): void {
  const rows: RouteRecord[] = [];
  app.decorate("routeInventory", rows);

  app.addHook("onRoute", (route) => {
    const { access } = route.config ?? {};
    if (!access) {
      if (route.url.startsWith("/api"))
        throw new Error(`Route ${String(route.method)} ${route.url} declares no access`);
      return;
    }
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const beforeTwoFactor = access.kind === "authenticated" && access.beforeTwoFactor;
    for (const method of methods) {
      rows.push({
        method,
        url: route.url,
        access: describeAccess(access),
        ...(beforeTwoFactor ? { beforeTwoFactor: true as const } : {}),
      });
    }
  });
}

// A second pass, because Fastify gives no fixed order between a GET and its HEAD
export function finalizeInventory(rows: RouteRecord[]): RouteRecord[] {
  const gets = new Set(rows.filter((row) => row.method === "GET").map((row) => row.url));
  return rows
    .map((row) => (row.method === "HEAD" && gets.has(row.url) ? { ...row, derived: true as const } : row))
    .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
}
