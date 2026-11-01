import { activityActorListSchema, activityListSchema, archiveListSchema } from "@gps_crm/shared";
import { apiGet, apiSend } from "../../lib/api";
import { isDateValue, startOfDay, startOfNextDay } from "../../lib/dayjs";
import type { Filters } from "../../lib/url-filters";

export const ACTIVITY_KEY = ["activity"];
export const ACTIVITY_ACTORS_KEY = ["activity-actors"];
export const ARCHIVE_KEY = ["archive"];

export const ACTIVITY_FILTER_KEYS = [
  "from",
  "to",
  "actorId",
  "subscriberId",
  "action",
  "entityType",
  "entityId",
] as const;
export type ActivityFilters = Filters<(typeof ACTIVITY_FILTER_KEYS)[number]>;

const PLAIN_FILTERS = ["actorId", "subscriberId", "action", "entityType", "entityId"] as const;

// The screen holds Kyiv dates, the API a period that ends where the next day starts. A date edited by hand into
// something else is left out here, and the date field shows it as empty.
export function activityQuery(filters: ActivityFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.from && isDateValue(filters.from)) params.set("from", startOfDay(filters.from));
  if (filters.to && isDateValue(filters.to)) params.set("to", startOfNextDay(filters.to));
  for (const key of PLAIN_FILTERS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchActivityPage(filters: ActivityFilters, cursor: string | null, signal: AbortSignal) {
  return apiGet(`/activity${activityQuery(filters, cursor)}`, activityListSchema, signal);
}

export function fetchActivityActors(signal: AbortSignal) {
  return apiGet("/activity/actors", activityActorListSchema, signal);
}

export function fetchArchivePage(cursor: string | null, signal: AbortSignal) {
  const query = cursor ? `?cursor=${cursor}` : "";
  return apiGet(`/archive${query}`, archiveListSchema, signal);
}

export function restoreBatch(id: string): Promise<void> {
  return apiSend("POST", `/archive/${id}/restore`);
}
