import {
  availableQuerySchema,
  deviceCreateSchema,
  deviceListQuerySchema,
  deviceUpdateSchema,
  equipmentCheckQuerySchema,
  sensorCreateSchema,
  sensorListQuerySchema,
  sensorUpdateSchema,
  simCreateSchema,
  simListQuerySchema,
  simUpdateSchema,
  type DeviceCard,
  type DeviceList,
  type EquipmentCheck,
  type SensorList,
  type SimCard,
  type SimList,
} from "@gps_crm/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { activityContext, can, recordScope, requireAuth } from "../../core/access/access.js";
import { API_PREFIX, type AppDeps } from "../../core/deps.js";
import { changing, creating, idOf } from "../../core/http/route-helpers.js";
import { parseInput } from "../../core/http/validate.js";
import { notFound } from "../references/index.js";
import { archiveEquipment, deleteEquipment, restoreEquipment } from "./equipment.archive.service.js";
import {
  checkIccid,
  checkImei,
  listDevices,
  listFreeDevices,
  listFreeSensors,
  listFreeSims,
  listSensors,
  listSims,
  readDeviceCard,
  readSimCard,
} from "./equipment.read.service.js";
import {
  registerDevice,
  registerSensor,
  registerSim,
  updateDevice,
  updateSensor,
  updateSim,
  type EquipmentKind,
} from "./equipment.service.js";

const DEVICES = `${API_PREFIX}/devices`;
const SIMS = `${API_PREFIX}/sims`;
const SENSORS = `${API_PREFIX}/sensors`;

const RECORD_PATHS: [string, EquipmentKind][] = [
  [DEVICES, "device"],
  [SIMS, "sim"],
  [SENSORS, "sensor"],
];

// Equipment belongs to no client, so the level `own` has nothing here: as a package of the reference lists
function requireAllRecords(request: FastifyRequest): void {
  if (recordScope(request).managerId) throw notFound();
}

function registerArchiveRoutes(app: FastifyInstance, deps: AppDeps): void {
  const archive = { config: { access: can("records.archive") } };
  const remove = { config: { access: can("records.delete") } };
  for (const [path, kind] of RECORD_PATHS) {
    app.post(
      `${path}/:id/archive`,
      archive,
      changing((request, id) => {
        requireAllRecords(request);
        return archiveEquipment(deps, activityContext(request), kind, id);
      }),
    );
    app.post(
      `${path}/:id/restore`,
      archive,
      changing((request, id) => {
        requireAllRecords(request);
        return restoreEquipment(deps, activityContext(request), kind, id);
      }),
    );
    app.delete(
      `${path}/:id`,
      remove,
      changing((request, id) => {
        requireAllRecords(request);
        return deleteEquipment(deps, activityContext(request), kind, id);
      }),
    );
  }
}

function registerDeviceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { config: { access: can("equipment.read") } };
  const write = { config: { access: can("equipment.write") } };

  app.get(DEVICES, read, (request): Promise<DeviceList> => {
    return listDevices(deps, parseInput(deviceListQuerySchema, request.query));
  });

  app.get(`${DEVICES}/available`, read, (request): Promise<DeviceList> => {
    return listFreeDevices(deps, parseInput(availableQuerySchema, request.query));
  });

  app.get(`${DEVICES}/imei-check`, read, (request): Promise<EquipmentCheck> => {
    const { value, excludeId } = parseInput(equipmentCheckQuerySchema, request.query);
    return checkImei(deps, value, excludeId);
  });

  app.get(`${DEVICES}/:id`, read, (request): Promise<DeviceCard> => readDeviceCard(deps, idOf(request)));

  app.post(
    DEVICES,
    write,
    creating((request) => {
      return registerDevice(deps, activityContext(request), parseInput(deviceCreateSchema, request.body));
    }),
  );

  app.patch(
    `${DEVICES}/:id`,
    write,
    changing((request, id) => {
      return updateDevice(deps, activityContext(request), id, parseInput(deviceUpdateSchema, request.body));
    }),
  );
}

function registerSimRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { config: { access: can("equipment.read") } };
  const write = { config: { access: can("equipment.write") } };

  app.get(SIMS, read, (request): Promise<SimList> => {
    return listSims(deps, parseInput(simListQuerySchema, request.query));
  });

  app.get(`${SIMS}/available`, read, (request): Promise<SimList> => {
    return listFreeSims(deps, parseInput(availableQuerySchema, request.query));
  });

  app.get(`${SIMS}/iccid-check`, read, (request): Promise<EquipmentCheck> => {
    const { value, excludeId } = parseInput(equipmentCheckQuerySchema, request.query);
    return checkIccid(deps, value, excludeId);
  });

  app.get(`${SIMS}/:id`, read, (request): Promise<SimCard> => {
    return readSimCard(deps, idOf(request), requireAuth(request).permissions.has("cost.read"));
  });

  app.post(
    SIMS,
    write,
    creating((request) => {
      return registerSim(deps, activityContext(request), parseInput(simCreateSchema, request.body));
    }),
  );

  app.patch(
    `${SIMS}/:id`,
    write,
    changing((request, id) => {
      return updateSim(deps, activityContext(request), id, parseInput(simUpdateSchema, request.body));
    }),
  );
}

function registerSensorRoutes(app: FastifyInstance, deps: AppDeps): void {
  const read = { config: { access: can("equipment.read") } };
  const write = { config: { access: can("equipment.write") } };

  app.get(SENSORS, read, (request): Promise<SensorList> => {
    return listSensors(deps, parseInput(sensorListQuerySchema, request.query));
  });

  app.get(`${SENSORS}/available`, read, (request): Promise<SensorList> => {
    return listFreeSensors(deps, parseInput(availableQuerySchema, request.query));
  });

  app.post(
    SENSORS,
    write,
    creating((request) => {
      return registerSensor(deps, activityContext(request), parseInput(sensorCreateSchema, request.body));
    }),
  );

  app.patch(
    `${SENSORS}/:id`,
    write,
    changing((request, id) => {
      return updateSensor(deps, activityContext(request), id, parseInput(sensorUpdateSchema, request.body));
    }),
  );
}

export function registerEquipmentRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerDeviceRoutes(app, deps);
  registerSimRoutes(app, deps);
  registerSensorRoutes(app, deps);
  registerArchiveRoutes(app, deps);
}
