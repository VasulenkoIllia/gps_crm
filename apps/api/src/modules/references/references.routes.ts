import {
  addonCreateSchema,
  addonUpdateSchema,
  costPriceInputSchema,
  datedPriceSchema,
  idParamsSchema,
  referenceListQuerySchema,
  REFERENCE_KINDS,
  serverCreateSchema,
  serverUpdateSchema,
  simpleReferenceInputSchema,
  simpleReferenceUpdateSchema,
  SIMPLE_REFERENCE_KINDS,
  simPlanCreateSchema,
  simPlanUpdateSchema,
  tariffCreateSchema,
  tariffUpdateSchema,
  tariffVersionInputSchema,
} from "@gps_crm/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { activityContext, can, requireAuth } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { parseInput } from "../../core/http/validate.js";
import { addAddonPrice, addCostPrice, createAddon, updateAddon } from "./addons.service.js";
import { deactivateReference } from "./archive.service.js";
import {
  createServer,
  createSimple,
  createSimPlan,
  listReferences,
  updateServer,
  updateSimple,
  updateSimPlan,
} from "./references.service.js";
import { createTariff, createTariffVersion, updateTariff } from "./tariffs.service.js";

const CREATED = 201;
const NO_CONTENT = 204;
const REFERENCES_PATH = `${API_PREFIX}/references`;

const manage = () => ({ config: { access: can("references.manage") } });

// A create route: what the service returns goes out as 201
function creating<T>(handler: (request: FastifyRequest) => Promise<T>) {
  return async (request: FastifyRequest, reply: FastifyReply) => reply.code(CREATED).send(await handler(request));
}

// A change route on a record: the id comes parsed, and the answer has no body
function changing(handler: (request: FastifyRequest, id: string) => Promise<void>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = parseInput(idParamsSchema, request.params);
    await handler(request, id);
    return reply.code(NO_CONTENT).send();
  };
}

function registerSimpleRoutes(app: FastifyInstance, deps: AppDeps): void {
  for (const kind of SIMPLE_REFERENCE_KINDS) {
    app.post(
      `${REFERENCES_PATH}/${kind}`,
      manage(),
      creating((request) => {
        const input = parseInput(simpleReferenceInputSchema, request.body);
        return createSimple(deps, activityContext(request), kind, input);
      }),
    );
    app.patch(
      `${REFERENCES_PATH}/${kind}/:id`,
      manage(),
      changing((request, id) => {
        const input = parseInput(simpleReferenceUpdateSchema, request.body);
        return updateSimple(deps, activityContext(request), kind, id, input);
      }),
    );
  }
}

function registerServerAndPlanRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    `${REFERENCES_PATH}/servers`,
    manage(),
    creating((request) => {
      return createServer(deps, activityContext(request), parseInput(serverCreateSchema, request.body));
    }),
  );
  app.patch(
    `${REFERENCES_PATH}/servers/:id`,
    manage(),
    changing((request, id) => {
      return updateServer(deps, activityContext(request), id, parseInput(serverUpdateSchema, request.body));
    }),
  );
  app.post(
    `${REFERENCES_PATH}/sim-plans`,
    manage(),
    creating((request) => {
      return createSimPlan(deps, activityContext(request), parseInput(simPlanCreateSchema, request.body));
    }),
  );
  app.patch(
    `${REFERENCES_PATH}/sim-plans/:id`,
    manage(),
    changing((request, id) => {
      return updateSimPlan(deps, activityContext(request), id, parseInput(simPlanUpdateSchema, request.body));
    }),
  );
}

function registerTariffRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    `${REFERENCES_PATH}/tariffs`,
    manage(),
    creating((request) => {
      return createTariff(deps, activityContext(request), parseInput(tariffCreateSchema, request.body));
    }),
  );
  app.patch(
    `${REFERENCES_PATH}/tariffs/:id`,
    manage(),
    changing((request, id) => {
      return updateTariff(deps, activityContext(request), id, parseInput(tariffUpdateSchema, request.body));
    }),
  );
  app.post(
    `${REFERENCES_PATH}/tariffs/:id/new-version`,
    manage(),
    creating((request) => {
      const { id } = parseInput(idParamsSchema, request.params);
      const input = parseInput(tariffVersionInputSchema, request.body);
      return createTariffVersion(deps, activityContext(request), id, input);
    }),
  );
}

function registerPriceRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    `${REFERENCES_PATH}/addons`,
    manage(),
    creating((request) => {
      return createAddon(deps, activityContext(request), parseInput(addonCreateSchema, request.body));
    }),
  );
  app.patch(
    `${REFERENCES_PATH}/addons/:id`,
    manage(),
    changing((request, id) => {
      return updateAddon(deps, activityContext(request), id, parseInput(addonUpdateSchema, request.body));
    }),
  );
  app.post(`${REFERENCES_PATH}/addons/:id/prices`, manage(), async (request, reply) => {
    const { id } = parseInput(idParamsSchema, request.params);
    await addAddonPrice(deps, activityContext(request), id, parseInput(datedPriceSchema, request.body));
    return reply.code(CREATED).send();
  });
  app.post(`${REFERENCES_PATH}/cost-prices`, manage(), async (request, reply) => {
    await addCostPrice(deps, activityContext(request), parseInput(costPriceInputSchema, request.body));
    return reply.code(CREATED).send();
  });
}

export function registerReferencesRoutes(app: FastifyInstance, deps: AppDeps): void {
  for (const kind of REFERENCE_KINDS) {
    // For the forms of every other module, hence the permission to read clients and not to manage these lists
    app.get(`${REFERENCES_PATH}/${kind}`, { config: { access: can("subscribers.read") } }, (request) => {
      const query = parseInput(referenceListQuerySchema, request.query);
      return listReferences(deps.db, kind, query, requireAuth(request).permissions.has("cost.read"));
    });
    app.post(
      `${REFERENCES_PATH}/${kind}/:id/deactivate`,
      manage(),
      changing((request, id) => deactivateReference(deps, activityContext(request), kind, id)),
    );
  }
  registerSimpleRoutes(app, deps);
  registerServerAndPlanRoutes(app, deps);
  registerTariffRoutes(app, deps);
  registerPriceRoutes(app, deps);
}
