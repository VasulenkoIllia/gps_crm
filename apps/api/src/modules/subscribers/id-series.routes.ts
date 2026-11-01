import { idSeriesCreateSchema, idSeriesUpdateSchema, type IdSeriesList } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { activityContext, can } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { createIdSeries, deleteIdSeries, listIdSeries, updateIdSeries } from "./id-series.service.js";
import { changing, creating } from "./route-helpers.js";

const PATH = `${API_PREFIX}/subscriber-id-series`;

export function registerIdSeriesRoutes(app: FastifyInstance, deps: AppDeps): void {
  const manage = { config: { access: can("references.manage") } };

  app.get(PATH, { config: { access: can("subscribers.read") } }, (): Promise<IdSeriesList> => listIdSeries(deps));

  app.post(
    PATH,
    manage,
    creating((request) => {
      const input = parseInput(idSeriesCreateSchema, request.body);
      return createIdSeries(deps, activityContext(request), input);
    }),
  );

  app.patch(
    `${PATH}/:id`,
    manage,
    changing((request, id) => {
      const input = parseInput(idSeriesUpdateSchema, request.body);
      return updateIdSeries(deps, activityContext(request), id, input);
    }),
  );

  app.delete(
    `${PATH}/:id`,
    manage,
    changing((request, id) => deleteIdSeries(deps, activityContext(request), id)),
  );
}
