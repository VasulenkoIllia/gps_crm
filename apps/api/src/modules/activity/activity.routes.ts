import {
  activityListQuerySchema,
  archiveBatchParamsSchema,
  archiveListQuerySchema,
  type ActivityActorList,
  type ActivityList,
  type ArchiveList,
} from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { activityContext, can } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import {
  listActivity,
  listActivityActors,
  listArchive,
  restoreArchiveBatch,
  type ArchiveRestorers,
} from "./activity.service.js";

const NO_CONTENT = 204;

export function registerActivityRoutes(app: FastifyInstance, deps: AppDeps, restorers: ArchiveRestorers): void {
  app.get(`${API_PREFIX}/activity`, { config: { access: can("activity.read") } }, (request): Promise<ActivityList> => {
    return listActivity(deps.db, parseInput(activityListQuerySchema, request.query));
  });

  // The filter by person: open to whoever reads the journal, unlike the list of users
  app.get(
    `${API_PREFIX}/activity/actors`,
    { config: { access: can("activity.read") } },
    (): Promise<ActivityActorList> => listActivityActors(deps.db),
  );

  app.get(`${API_PREFIX}/archive`, { config: { access: can("records.archive") } }, (request): Promise<ArchiveList> => {
    return listArchive(deps.db, parseInput(archiveListQuerySchema, request.query));
  });

  app.post(
    `${API_PREFIX}/archive/:batchId/restore`,
    { config: { access: can("records.archive") } },
    async (request, reply) => {
      const { batchId } = parseInput(archiveBatchParamsSchema, request.params);
      await restoreArchiveBatch(deps.db, restorers, activityContext(request), batchId);
      return reply.code(NO_CONTENT).send();
    },
  );
}
