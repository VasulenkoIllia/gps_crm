import {
  createdEquipmentSchema,
  deviceCardSchema,
  deviceListSchema,
  equipmentCheckSchema,
  sensorListSchema,
  simCardSchema,
  simListSchema,
  type EquipmentCheck,
} from "@gps_crm/shared";
import { apiGet, apiPost, apiSend } from "../../lib/api";
import type { Filters } from "../../lib/url-filters";
import type { RemoteOption } from "../../ui";
import { queryOf, SUBSCRIBERS_KEY } from "../subscribers/subscribers.api";

// Under the clients: what stands on an object changes its card and the card of the client, and one refresh reaches all
export const EQUIPMENT_KEY = [...SUBSCRIBERS_KEY, "equipment"];
export const deviceKey = (id: string) => [...EQUIPMENT_KEY, "device", id];
export const simKey = (id: string) => [...EQUIPMENT_KEY, "sim", id];

const SEARCH_LIMIT = 20;

export const DEVICE_FILTER_KEYS = ["q", "status", "modelId", "contractorId", "archived"] as const;
export type DeviceFilters = Filters<(typeof DEVICE_FILTER_KEYS)[number]>;

export const SIM_FILTER_KEYS = ["q", "status", "operatorId", "contractorId", "archived"] as const;
export type SimFilters = Filters<(typeof SIM_FILTER_KEYS)[number]>;

export const SENSOR_FILTER_KEYS = ["q", "contractorId", "archived"] as const;
export type SensorFilters = Filters<(typeof SENSOR_FILTER_KEYS)[number]>;

export type EquipmentPath = "devices" | "sims" | "sensors";

export function fetchDevices(filters: DeviceFilters, cursor: string | null, signal: AbortSignal) {
  return apiGet(`/devices${queryOf({ ...filters, cursor })}`, deviceListSchema, signal);
}

export function fetchSims(filters: SimFilters, cursor: string | null, signal: AbortSignal) {
  return apiGet(`/sims${queryOf({ ...filters, cursor })}`, simListSchema, signal);
}

export function fetchSensors(filters: SensorFilters, cursor: string | null, signal: AbortSignal) {
  return apiGet(`/sensors${queryOf({ ...filters, cursor })}`, sensorListSchema, signal);
}

export function fetchDevice(id: string, signal: AbortSignal) {
  return apiGet(`/devices/${id}`, deviceCardSchema, signal);
}

export function fetchSim(id: string, signal: AbortSignal) {
  return apiGet(`/sims/${id}`, simCardSchema, signal);
}

// The number is the value: what a person types and what they pick from the stock go the same way (objects.md §5)
export async function searchFreeDevices(text: string, signal: AbortSignal): Promise<RemoteOption[]> {
  const query = queryOf({ q: text, limit: String(SEARCH_LIMIT) });
  const { items } = await apiGet(`/devices/available${query}`, deviceListSchema, signal);
  return items.map(({ imei, modelName }) => ({ value: imei, label: modelName ? `${imei}, ${modelName}` : imei }));
}

export async function searchFreeSims(text: string, signal: AbortSignal): Promise<RemoteOption[]> {
  const query = queryOf({ q: text, limit: String(SEARCH_LIMIT) });
  const { items } = await apiGet(`/sims/available${query}`, simListSchema, signal);
  return items.map(({ iccid, msisdn }) => ({ value: iccid, label: msisdn ? `${iccid}, ${msisdn}` : iccid }));
}

export async function searchFreeSensors(text: string, signal: AbortSignal): Promise<RemoteOption[]> {
  const query = queryOf({ q: text, limit: String(SEARCH_LIMIT) });
  const { items } = await apiGet(`/sensors/available${query}`, sensorListSchema, signal);
  return items.map(({ serialNo }) => ({ value: serialNo, label: serialNo }));
}

export function checkImei(value: string, excludeId: string, signal: AbortSignal): Promise<EquipmentCheck> {
  return apiGet(`/devices/imei-check${queryOf({ value, excludeId })}`, equipmentCheckSchema, signal);
}

export function checkIccid(value: string, excludeId: string, signal: AbortSignal): Promise<EquipmentCheck> {
  return apiGet(`/sims/iccid-check${queryOf({ value, excludeId })}`, equipmentCheckSchema, signal);
}

export function registerEquipment(path: EquipmentPath, input: object) {
  return apiPost(`/${path}`, createdEquipmentSchema, input);
}

export function updateEquipment(path: EquipmentPath, id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/${path}/${id}`, input);
}

export function equipmentAction(path: EquipmentPath, id: string, action: "archive" | "restore"): Promise<void> {
  return apiSend("POST", `/${path}/${id}/${action}`);
}

export function deleteEquipment(path: EquipmentPath, id: string): Promise<void> {
  return apiSend("DELETE", `/${path}/${id}`);
}
