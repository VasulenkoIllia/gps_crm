import { HEALTH_STATUS, type HealthResponse } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { publicRoute } from "../access/access.js";

const SERVICE_UNAVAILABLE = 503;
// The container healthcheck calls these every few seconds: a request line each time would flood the rotated log
const ROUTE_LOG_LEVEL = "warn";
// Below the healthcheck timeout in infra/compose.yml, so a busy pool answers 503 instead of a killed check
export const READY_TIMEOUT_MS = 2_000;
const READY_CACHE_MS = 2_000;

async function withTimeout(check: Promise<void>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("readiness check timed out")), READY_TIMEOUT_MS);
  });
  try {
    await Promise.race([check, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// The route is public: many calls share one check, so they cannot take the app's database connections
function sharedCheck(checkReady: () => Promise<void>): () => Promise<void> {
  let last: { startedAt: number; result: Promise<void> } | undefined;
  return () => {
    const now = Date.now();
    if (last && now - last.startedAt < READY_CACHE_MS) return last.result;
    last = { startedAt: now, result: withTimeout(checkReady()) };
    return last.result;
  };
}

export function registerHealthRoutes(app: FastifyInstance, checkReady: () => Promise<void>): void {
  const check = sharedCheck(checkReady);

  const options = { logLevel: ROUTE_LOG_LEVEL, config: { access: publicRoute() } } as const;

  app.get("/health", options, (): HealthResponse => ({ status: HEALTH_STATUS.ok }));

  app.get("/health/ready", options, async (request, reply): Promise<HealthResponse> => {
    try {
      await check();
      return { status: HEALTH_STATUS.ok };
    } catch (error) {
      request.log.warn({ err: error }, "readiness check failed");
      reply.code(SERVICE_UNAVAILABLE);
      return { status: HEALTH_STATUS.unavailable };
    }
  });
}
