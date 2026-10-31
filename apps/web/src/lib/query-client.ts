import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

const STALE_TIME_MS = 30_000;
const MAX_RETRIES = 1;

// A 4xx repeats the same way: only a failed network or server gets a second try
export function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.isClientError) return false;
  return failureCount < MAX_RETRIES;
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: STALE_TIME_MS, retry: shouldRetry, refetchOnWindowFocus: false } },
});
