import { idSeriesListSchema } from "@gps_crm/shared";
import { apiGet, apiSend } from "../../lib/api";
import { SUBSCRIBERS_KEY } from "../subscribers/subscribers.api";

export const ID_SERIES_KEY = [...SUBSCRIBERS_KEY, "id-series"];

export function fetchIdSeries(signal: AbortSignal) {
  return apiGet("/subscriber-id-series", idSeriesListSchema, signal);
}

export function createIdSeries(input: object): Promise<void> {
  return apiSend("POST", "/subscriber-id-series", input);
}

export function updateIdSeries(id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/subscriber-id-series/${id}`, input);
}

export function deleteIdSeries(id: string): Promise<void> {
  return apiSend("DELETE", `/subscriber-id-series/${id}`);
}
