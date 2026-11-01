import { jobNameParamsSchema, type JobList, type SystemStatus } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { activityContext, can } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { listJobs, readSystemStatus, runJobByHand } from "./system.service.js";

const ACCEPTED = 202;

export function registerSystemRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get(`${API_PREFIX}/system/status`, { config: { access: can("system.read") } }, (): Promise<SystemStatus> =>
    readSystemStatus(deps),
  );

  app.get(`${API_PREFIX}/system/jobs`, { config: { access: can("system.read") } }, (): Promise<JobList> =>
    listJobs(deps),
  );

  app.post(
    `${API_PREFIX}/system/jobs/:name/run`,
    { config: { access: can("system.read") } },
    async (request, reply) => {
      const { name } = parseInput(jobNameParamsSchema, request.params);
      await runJobByHand(deps, activityContext(request), name);
      return reply.code(ACCEPTED).send();
    },
  );
}
