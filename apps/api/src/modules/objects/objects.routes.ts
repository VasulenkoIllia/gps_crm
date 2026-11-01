import {
  activityListQuerySchema,
  addSensorSchema,
  objectAddonChangeSchema,
  objectCountQuerySchema,
  objectCreateSchema,
  objectListQuerySchema,
  objectSensorParamsSchema,
  objectStatusChangeSchema,
  objectTermsChangeSchema,
  objectUpdateSchema,
  removeSensorSchema,
  replaceDeviceSchema,
  replaceSimSchema,
  type ActivityList,
  type ObjectCard,
  type ObjectCount,
  type ObjectHistory,
  type ObjectList,
} from "@gps_crm/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { activityContext, can, recordScope, recordScopeOf } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { changing, creating, idOf } from "../../core/http/route-helpers.js";
import { parseInput } from "../../core/http/validate.js";
import { changeObjectAddons, changeObjectStatus, changeObjectTerms } from "./objects.actions.service.js";
import { archiveObject, restoreObject } from "./objects.archive.service.js";
import { addSensor, replaceDevice, replaceSim, takeSensorOff } from "./objects.equipment.service.js";
import {
  countObjects,
  listObjectActivity,
  listObjects,
  readObjectCard,
  readObjectHistory,
} from "./objects.read.service.js";
import { createObject, deleteObject, updateObject } from "./objects.service.js";

const PATH = `${API_PREFIX}/objects`;
const NO_CONTENT = 204;

function registerReadRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { config: { access: can("objects.read") } };

  app.get(PATH, read, (request): Promise<ObjectList> => {
    return listObjects(deps, parseInput(objectListQuerySchema, request.query), recordScope(request));
  });

  app.get(`${PATH}/count`, read, (request): Promise<ObjectCount> => {
    return countObjects(deps, parseInput(objectCountQuerySchema, request.query), recordScope(request));
  });

  app.get(`${PATH}/:id`, read, (request): Promise<ObjectCard> => {
    return readObjectCard(deps, idOf(request), recordScope(request));
  });

  app.get(`${PATH}/:id/history`, read, (request): Promise<ObjectHistory> => {
    return readObjectHistory(deps, idOf(request), recordScope(request));
  });

  app.get(`${PATH}/:id/activity`, { config: { access: can("activity.read") } }, (request): Promise<ActivityList> => {
    const query = parseInput(activityListQuerySchema, request.query);
    return listObjectActivity(deps, idOf(request), query, recordScope(request));
  });
}

function registerRecordRoutes(app: FastifyInstance, deps: AppDeps): void {
  const write = { config: { access: can("objects.write") } };
  const archive = { config: { access: can("records.archive") } };

  app.post(
    PATH,
    write,
    creating((request) => {
      const input = parseInput(objectCreateSchema, request.body);
      return createObject(deps, activityContext(request), recordScope(request), input);
    }),
  );

  app.patch(
    `${PATH}/:id`,
    write,
    changing((request, id) => {
      const input = parseInput(objectUpdateSchema, request.body);
      return updateObject(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/status`,
    { config: { access: can("objects.status.change") } },
    changing((request, id) => {
      const input = parseInput(objectStatusChangeSchema, request.body);
      return changeObjectStatus(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/terms`,
    write,
    changing((request, id) => {
      const input = parseInput(objectTermsChangeSchema, request.body);
      return changeObjectTerms(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/addons`,
    write,
    changing((request, id) => {
      const input = parseInput(objectAddonChangeSchema, request.body);
      return changeObjectAddons(deps, activityContext(request), recordScope(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/archive`,
    archive,
    changing((request, id) => archiveObject(deps, activityContext(request), recordScope(request), id)),
  );

  app.post(
    `${PATH}/:id/restore`,
    archive,
    changing((request, id) => restoreObject(deps, activityContext(request), recordScope(request), id)),
  );

  app.delete(
    `${PATH}/:id`,
    { config: { access: can("records.delete") } },
    changing((request, id) => deleteObject(deps, activityContext(request), recordScope(request), id)),
  );
}

function registerEquipmentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const write = { config: { access: can("equipment.write") } };
  // `equipment.write` has no level of its own: the object behind it stays behind the levels of the object permissions
  const scopeOf = (request: FastifyRequest) => recordScopeOf(request, "objects.read", "objects.write");

  app.post(
    `${PATH}/:id/replace-device`,
    write,
    changing((request, id) => {
      const input = parseInput(replaceDeviceSchema, request.body);
      return replaceDevice(deps, activityContext(request), scopeOf(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/replace-sim`,
    write,
    changing((request, id) => {
      const input = parseInput(replaceSimSchema, request.body);
      return replaceSim(deps, activityContext(request), scopeOf(request), id, input);
    }),
  );

  app.post(
    `${PATH}/:id/sensors`,
    write,
    changing((request, id) => {
      const input = parseInput(addSensorSchema, request.body);
      return addSensor(deps, activityContext(request), scopeOf(request), id, input);
    }),
  );

  // Two ids in the path, so `changing` does not fit
  app.post(`${PATH}/:id/sensors/:sensorId/remove`, write, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id, sensorId } = parseInput(objectSensorParamsSchema, request.params);
    const input = parseInput(removeSensorSchema, request.body);
    await takeSensorOff(deps, activityContext(request), scopeOf(request), id, sensorId, input);
    return reply.code(NO_CONTENT).send();
  });
}

export function registerObjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerReadRoutes(app, deps);
  registerRecordRoutes(app, deps);
  registerEquipmentRoutes(app, deps);
}
