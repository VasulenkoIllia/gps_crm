export { REFERENCE_RESTORERS } from "./archive.service.js";
export {
  assertVersion,
  changedFields,
  hasChanges,
  notFound,
  recordArchived,
  requireActive,
  type FieldChanges,
} from "./references.helpers.js";
export { registerReferencesRoutes } from "./references.routes.js";
export { selectTariff, type SelectedTariff } from "./tariffs.service.js";

export const OWNED_TABLES = [
  "programs",
  "monitoring_servers",
  "tariffs",
  "addons",
  "addon_prices",
  "addon_programs",
  "tracker_models",
  "sim_operators",
  "sim_plans",
  "contractors",
  "disconnect_reasons",
  "cost_prices",
];
