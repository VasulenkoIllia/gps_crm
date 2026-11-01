import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../core/deps.js";
import type { ClientObjects } from "./client-objects.js";
import { registerContactRoutes } from "./contacts.routes.js";
import { registerContractRoutes } from "./contracts.routes.js";
import { registerIdSeriesRoutes } from "./id-series.routes.js";
import { registerPayerRoutes } from "./payers.routes.js";
import { registerSubscriberRoutes } from "./subscribers.routes.js";

export { subscriberRestorers } from "./archive.service.js";
export type { ArchivedObject, ClientObjects } from "./client-objects.js";
export { lockClientPayer, requireClientPayer } from "./payers.service.js";
export { refreshRollup, requireLiveSubscriber } from "./subscribers.helpers.js";
export { lockSubscribers } from "./subscribers.repository.js";
export { reconcileRollups, SUBSCRIBERS_ROLLUP_JOB } from "./subscribers.jobs.js";

export function registerSubscribersRoutes(app: FastifyInstance, deps: AppDeps, objects: ClientObjects): void {
  const packageDeps = { ...deps, objects };
  registerSubscriberRoutes(app, packageDeps);
  registerContactRoutes(app, packageDeps);
  registerPayerRoutes(app, packageDeps);
  registerContractRoutes(app, packageDeps);
  registerIdSeriesRoutes(app, deps);
}

export const OWNED_TABLES = [
  "subscribers",
  "subscriber_id_series",
  "subscriber_id_series_types",
  "subscriber_tariff_periods",
  "contacts",
  "payers",
  "payer_subscribers",
  "contracts",
];
