import { exportRequestSchema, type ExportJob, type ExportRequest } from "@gps_crm/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { activityContext, can, recordScopeOf, requireAuth, type RecordScope } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { contentDisposition } from "../../core/http/content-disposition.js";
import { idOf } from "../../core/http/route-helpers.js";
import { parseInput } from "../../core/http/validate.js";
import { openExportFile, readExport, requestExport } from "./exports.service.js";

const PATH = `${API_PREFIX}/exports`;
const CREATED = 201;
// Each request reads a whole list in the background: more than this a minute is no person at work
const EXPORT_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

// The list is read with the level of its own permission, narrowed by the one of `data.export`, and refused without the
// first: no export of what the person cannot open (search-exports.md C)
function scopeOf(request: FastifyRequest, input: ExportRequest): RecordScope {
  if (input.entity === "subscribers" || input.entity === "contracts") {
    return recordScopeOf(request, "subscribers.read", "data.export");
  }
  if (input.entity === "objects") return recordScopeOf(request, "objects.read", "data.export");
  return recordScopeOf(request, "equipment.read");
}

export function registerExportRoutes(app: FastifyInstance, deps: AppDeps): void {
  const access = { access: can("data.export") };

  app.post(PATH, { config: { ...access, rateLimit: EXPORT_RATE_LIMIT } }, async (request, reply) => {
    const input = parseInput(exportRequestSchema, request.body);
    const job = await requestExport(deps, activityContext(request), input, scopeOf(request, input));
    return reply.code(CREATED).send(job);
  });

  app.get(`${PATH}/:id`, { config: access }, (request): Promise<ExportJob> => {
    return readExport(deps, idOf(request), requireAuth(request).userId);
  });

  app.get(`${PATH}/:id/file`, { config: access }, async (request, reply: FastifyReply) => {
    const userId = requireAuth(request).userId;
    const file = await openExportFile(deps, activityContext(request), idOf(request), userId);
    return (
      reply
        .header("content-type", file.mime)
        // A download cut short shows as one in the browser
        .header("content-length", file.size)
        .header("content-disposition", contentDisposition("attachment", file.name))
        .header("cache-control", "private, no-store")
        .send(file.content)
    );
  });
}
