import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF, second line behind SameSite=Lax (06-quality.md §6.2.4). A browser names the Origin on every changing request;
// its absence means a client without cookies of ours. No check of the path: this hook sees the raw URL, and /%61pi/...
// reaches the same route as /api/...
export function registerOriginCheck(app: FastifyInstance, appUrl: string): void {
  app.addHook("onRequest", (request, _reply, done) => {
    const { origin } = request.headers;
    const isForeign = !SAFE_METHODS.has(request.method) && origin !== undefined && origin !== appUrl;
    done(isForeign ? new AppError(403, "origin_mismatch", "Запит із чужого сайту відхилено") : undefined);
  });
}
