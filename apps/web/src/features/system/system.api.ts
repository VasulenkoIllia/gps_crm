import { activityListSchema, jobListSchema, systemStatusSchema } from "@gps_crm/shared";
import { apiGet, apiSend } from "../../lib/api";

export const SYSTEM_KEY = ["system"];
export const SYSTEM_STATUS_KEY = ["system", "status"];
export const SYSTEM_JOBS_KEY = ["system", "jobs"];
export const SYSTEM_RECENT_KEY = ["system", "recent-activity"];

// There are no outside alerts (D20): this screen is what a person looks at, and an open tab keeps it current
export const SYSTEM_REFRESH_MS = 60_000;

const RECENT_ACTIONS = 10;

export function fetchSystemStatus(signal: AbortSignal) {
  return apiGet("/system/status", systemStatusSchema, signal);
}

export function fetchJobs(signal: AbortSignal) {
  return apiGet("/system/jobs", jobListSchema, signal);
}

export function fetchRecentActivity(signal: AbortSignal) {
  return apiGet(`/activity?limit=${RECENT_ACTIONS}`, activityListSchema, signal);
}

export function requestJobRun(name: string): Promise<void> {
  return apiSend("POST", `/system/jobs/${name}/run`);
}
