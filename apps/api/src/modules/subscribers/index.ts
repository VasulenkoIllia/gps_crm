import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../../core/deps.js";
import { registerContactRoutes } from "./contacts.routes.js";
import { registerContractRoutes } from "./contracts.routes.js";
import { registerIdSeriesRoutes } from "./id-series.routes.js";
import { registerPayerRoutes } from "./payers.routes.js";
import { registerSubscriberRoutes } from "./subscribers.routes.js";

export { SUBSCRIBER_RESTORERS } from "./archive.service.js";
export { reconcileRollups, SUBSCRIBERS_ROLLUP_JOB } from "./subscribers.jobs.js";

export function registerSubscribersRoutes(app: FastifyInstance, deps: AppDeps): void {
  registerSubscriberRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerPayerRoutes(app, deps);
  registerContractRoutes(app, deps);
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
