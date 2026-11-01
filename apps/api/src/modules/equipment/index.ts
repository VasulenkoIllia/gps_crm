export { registerEquipmentRoutes } from "./equipment.routes.js";
export { EQUIPMENT_RESTORERS } from "./equipment.archive.service.js";
export { lockDevices } from "./equipment.repository.js";
export {
  deviceIdOf,
  discardEquipment,
  installDevice,
  installSensor,
  installSim,
  letSimGo,
  lockTracker,
  releaseEquipment,
  removeSensor,
  replaceSimOf,
  requireContractor,
  takeDevice,
  takeSensor,
  takeSim,
  takeTrackerOff,
  type Tracker,
} from "./installations.service.js";

export const OWNED_TABLES = [
  "devices",
  "sims",
  "sensors",
  "device_installations",
  "sim_installations",
  "sensor_installations",
];
