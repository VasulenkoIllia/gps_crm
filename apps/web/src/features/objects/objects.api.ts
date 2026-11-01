import {
  activityListSchema,
  createdObjectSchema,
  objectCardSchema,
  objectCountSchema,
  objectHistorySchema,
  objectListSchema,
  type SortOrder,
} from "@gps_crm/shared";
import { apiGet, apiPost, apiSend } from "../../lib/api";
import type { Filters } from "../../lib/url-filters";
import { queryOf, SUBSCRIBERS_KEY } from "../subscribers/subscribers.api";

// Under the clients: an object moves the numbers and the status of its client, and one refresh reaches both
export const OBJECTS_KEY = [...SUBSCRIBERS_KEY, "objects"];
export const objectKey = (id: string) => [...OBJECTS_KEY, "card", id];
export const objectHistoryKey = (id: string) => [...OBJECTS_KEY, "history", id];

export const OBJECT_FILTER_KEYS = [
  "q",
  "status",
  "programId",
  "serverId",
  "tariffId",
  "modelId",
  "addonId",
  "subscriberId",
  "managerId",
  "archived",
] as const;
export type ObjectFilters = Filters<(typeof OBJECT_FILTER_KEYS)[number]>;

interface ObjectPageParams {
  filters: ObjectFilters;
  sort?: string;
  order?: SortOrder;
  cursor: string | null;
}

export function fetchObjects({ filters, sort, order, cursor }: ObjectPageParams, signal: AbortSignal) {
  return apiGet(`/objects${queryOf({ ...filters, sort, order, cursor })}`, objectListSchema, signal);
}

export function fetchObjectCount(filters: ObjectFilters, signal: AbortSignal) {
  return apiGet(`/objects/count${queryOf(filters)}`, objectCountSchema, signal);
}

export function fetchObject(id: string, signal: AbortSignal) {
  return apiGet(`/objects/${id}`, objectCardSchema, signal);
}

export function fetchObjectHistory(id: string, signal: AbortSignal) {
  return apiGet(`/objects/${id}/history`, objectHistorySchema, signal);
}

export function fetchObjectActivity(id: string, cursor: string | null, signal: AbortSignal) {
  return apiGet(`/objects/${id}/activity${queryOf({ cursor })}`, activityListSchema, signal);
}

export function createObject(input: object) {
  return apiPost("/objects", createdObjectSchema, input);
}

export function updateObject(id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/objects/${id}`, input);
}

export function deleteObject(id: string): Promise<void> {
  return apiSend("DELETE", `/objects/${id}`);
}

type ObjectAction =
  "status" | "terms" | "addons" | "replace-device" | "replace-sim" | "sensors" | "archive" | "restore";

export function objectAction(id: string, action: ObjectAction, input?: object): Promise<void> {
  return apiSend("POST", `/objects/${id}/${action}`, input);
}

export function removeObjectSensor(id: string, sensorId: string, input: object): Promise<void> {
  return apiSend("POST", `/objects/${id}/sensors/${sensorId}/remove`, input);
}
