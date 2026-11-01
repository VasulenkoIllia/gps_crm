import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";
import { loginPath } from "./login-path";

// The root of every RemoteSelect, for whoever changes the records they show
export const REMOTE_SELECT_KEY = ["remote-select"];

const STALE_TIME_MS = 30_000;
const MAX_RETRIES = 1;
const UNAUTHORIZED = 401;
// Only this code: a wrong password or a wrong 2FA code is a 401 too, and the form shows those
const SESSION_LOST_CODE = "unauthorized";

// A 4xx repeats the same way: only a failed network or server gets a second try
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.isClientError) return false;
  return failureCount < MAX_RETRIES;
}

export function isSessionLost(error: unknown): boolean {
  return error instanceof ApiError && error.status === UNAUTHORIZED && error.code === SESSION_LOST_CODE;
}

// Several queries of a page meet the same 401, and each new navigation would restart the one before it
let isLeaving = false;

// Blocked, signed out elsewhere or expired: a full page load, so the data of the page stay neither on the screen nor in
// memory. Not queryClient.clear(): the screen still on show would fetch again and come back here, over and over.
function leaveWhenSessionLost(error: unknown): void {
  if (isLeaving || !isSessionLost(error)) return;
  isLeaving = true;
  const { pathname, search } = window.location;
  window.location.replace(loginPath(`${pathname}${search}`));
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: leaveWhenSessionLost }),
  mutationCache: new MutationCache({ onError: leaveWhenSessionLost }),
  defaultOptions: { queries: { staleTime: STALE_TIME_MS, retry: shouldRetry, refetchOnWindowFocus: false } },
});
