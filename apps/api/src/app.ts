import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { NOT_FOUND_ERROR, registerErrorHandling } from "./core/errors.js";
import { registerHealthRoutes } from "./core/http/health.js";
import { registerSecurityHeaders } from "./core/http/security.js";
import { isSpaRoute, registerSpa } from "./core/http/spa.js";

// 06-quality.md §6.2
const BODY_LIMIT_BYTES = 1_048_576;
// Above the 90 s Traefik keeps an idle backend connection: it must not reuse a socket the app has just closed (502)
const KEEP_ALIVE_TIMEOUT_MS = 95_000;
// Fastify's default is no limit at all on a slow request body. Long work runs as a background job, not in a request.
const REQUEST_TIMEOUT_MS = 60_000;

export interface AppOptions {
  logger?: FastifyBaseLogger;
  // Folder with the built web app; unset in development, where Vite serves the UI
  webRoot?: string;
  // Rejects with the reason when the app must not take traffic
  checkReady: () => Promise<void>;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  // Traefik reaches the app over the Docker network, so private addresses count as proxies. Behind Cloudflare the last
  // public address is a Cloudflare edge, not the client, and another container on the shared proxy network can set
  // X-Forwarded-For. Never grant access by request.ip; login limits settle the chain first (14-stage1-plan.md, step 1).
  const app = Fastify({
    loggerInstance: options.logger,
    bodyLimit: BODY_LIMIT_BYTES,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    genReqId: () => randomUUID(),
    trustProxy: ["loopback", "linklocal", "uniquelocal"],
  });

  registerErrorHandling(app);
  await registerSecurityHeaders(app);
  registerHealthRoutes(app, options.checkReady);

  const { webRoot } = options;
  if (webRoot) await registerSpa(app, webRoot);

  app.setNotFoundHandler((request, reply) => {
    if (webRoot && isSpaRoute(request.method, request.url)) return reply.sendFile("index.html");
    return reply.code(404).send(NOT_FOUND_ERROR);
  });

  return app;
}
