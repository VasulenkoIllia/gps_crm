import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { registerAccessControl } from "./core/access/access.js";
import { collectRouteInventory } from "./core/access/route-inventory.js";
import type { AppDeps } from "./core/deps.js";
import { NOT_FOUND_ERROR, registerErrorHandling } from "./core/errors.js";
import { clientIp, throttleAddress } from "./core/http/client-ip.js";
import { registerHealthRoutes } from "./core/http/health.js";
import { registerOriginCheck } from "./core/http/origin.js";
import { registerSecurityHeaders } from "./core/http/security.js";
import { isSpaRoute, registerSpa } from "./core/http/spa.js";
import { registerAccessRoutes } from "./modules/access/index.js";
import { registerActivityRoutes, type ArchiveRestorers } from "./modules/activity/index.js";
import { registerAuthRoutes } from "./modules/auth/index.js";
import { REFERENCE_RESTORERS, registerReferencesRoutes } from "./modules/references/index.js";
import { registerSystemRoutes } from "./modules/system/index.js";
import { registerTwoFactorRoutes } from "./modules/two-factor/index.js";
import { registerUsersRoutes } from "./modules/users/index.js";

// 06-quality.md §6.2
const BODY_LIMIT_BYTES = 1_048_576;
// Above the 90 s Traefik keeps an idle backend connection: it must not reuse a socket the app has just closed (502)
const KEEP_ALIVE_TIMEOUT_MS = 95_000;
// Fastify's default is no limit at all on a slow request body. Long work runs as a background job, not in a request.
const REQUEST_TIMEOUT_MS = 60_000;

export interface AppOptions extends Omit<AppDeps, "logger"> {
  logger?: FastifyBaseLogger;
  // Folder with the built web app; unset in development, where Vite serves the UI
  webRoot?: string;
  // Rejects with the reason when the app must not take traffic
  checkReady: () => Promise<void>;
  // Beside the ones of the modules: what a test brings back with a restorer of its own
  archiveRestorers?: ArchiveRestorers;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  // Traefik reaches the app over the Docker network, so private addresses count as proxies. What that leaves in
  // request.ip is settled by clientIp (core/http/client-ip.ts): use that, not request.ip, for anything about the caller.
  const app = Fastify({
    loggerInstance: options.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    genReqId: () => randomUUID(),
    trustProxy: ["loopback", "linklocal", "uniquelocal"],
  });
  const { db, config, mailer, jobs } = options;
  const deps: AppDeps = { db, config, mailer, jobs, logger: app.log };

  registerErrorHandling(app);
  collectRouteInventory(app);
  await registerSecurityHeaders(app);
  await app.register(cookie);
  // Per route, on the routes that take a credential; in memory, as there is one container
  await app.register(rateLimit, { global: false, keyGenerator: (request) => throttleAddress(clientIp(request)) });
  registerOriginCheck(app, config.appUrl);
  registerAccessControl(app, db, config.isProduction);
  registerHealthRoutes(app, options.checkReady);
  registerUsersRoutes(app, deps);
  registerTwoFactorRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerAccessRoutes(app);
  registerActivityRoutes(app, deps, { ...REFERENCE_RESTORERS, ...options.archiveRestorers });
  registerReferencesRoutes(app, deps);
  registerSystemRoutes(app, deps);

  const { webRoot } = options;
  if (webRoot) await registerSpa(app, webRoot);

  app.setNotFoundHandler((request, reply) => {
    if (webRoot && isSpaRoute(request.method, request.url)) return reply.sendFile("index.html");
    return reply.code(404).send(NOT_FOUND_ERROR);
  });

  return app;
}
