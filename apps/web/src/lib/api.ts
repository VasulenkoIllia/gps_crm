import { parseApiError, parseHealthResponse, type HealthResponse } from "@gps_crm/shared";

const SERVICE_UNAVAILABLE = 503;
const REQUEST_TIMEOUT_MS = 15_000;
const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;
const UNEXPECTED_ERROR = "Сталася помилка. Спробуйте ще раз.";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(status: number, code: string, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  get isClientError(): boolean {
    return this.status >= CLIENT_ERROR_MIN && this.status < SERVER_ERROR_MIN;
  }
}

function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// A proxy in front of the API answers with its own pages, so the body may be anything
async function toApiError(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  const error = parseApiError(body);
  return new ApiError(
    response.status,
    error?.code ?? "unexpected_response",
    error?.message ?? UNEXPECTED_ERROR,
    error?.fieldErrors,
  );
}

// Every call to /api goes through here; pass the signal React Query gives, so a left page cancels its requests
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, { ...init, signal: withTimeout(init.signal ?? undefined) });
  if (!response.ok) throw await toApiError(response);
  return response;
}

// 503 is a valid answer here: the body says the app is up but not ready, which the caller shows as a state
export async function fetchReadiness(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/health/ready", { signal: withTimeout(signal) });
  if (!response.ok && response.status !== SERVICE_UNAVAILABLE) throw await toApiError(response);
  return parseHealthResponse(await response.json());
}
