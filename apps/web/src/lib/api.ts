import { parseApiError, parseHealthResponse, type HealthResponse } from "@gps_crm/shared";

const SERVICE_UNAVAILABLE = 503;
const REQUEST_TIMEOUT_MS = 15_000;
// A scan of 20 MB over a phone connection
const UPLOAD_TIMEOUT_MS = 120_000;
const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;
const UNEXPECTED_ERROR = "Сталася помилка. Спробуйте ще раз.";
export const API_BASE = "/api/v1";

interface Parser<T> {
  parse: (value: unknown) => T;
}

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

export async function apiGet<T>(path: string, schema: Parser<T>, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(`${API_BASE}${path}`, { signal });
  return schema.parse(await response.json());
}

// The header only with a body: Fastify refuses an empty body declared as JSON
function writeInit(method: string, body: unknown): RequestInit {
  if (body === undefined) return { method };
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export async function apiPost<T>(path: string, schema: Parser<T>, body?: unknown): Promise<T> {
  const response = await apiFetch(`${API_BASE}${path}`, writeInit("POST", body));
  return schema.parse(await response.json());
}

// For the answers with no body
export async function apiSend(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<void> {
  await apiFetch(`${API_BASE}${path}`, writeInit(method, body));
}

// No content-type here: the browser writes it, with the boundary of the form
export async function apiUpload(path: string, file: File): Promise<void> {
  const body = new FormData();
  body.append("file", file);
  const signal = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", body, signal });
  if (!response.ok) throw await toApiError(response);
}

// 503 is a valid answer here: the body says the app is up but not ready, which the caller shows as a state
export async function fetchReadiness(signal?: AbortSignal): Promise<HealthResponse> {
  const response = await fetch("/health/ready", { signal: withTimeout(signal) });
  if (!response.ok && response.status !== SERVICE_UNAVAILABLE) throw await toApiError(response);
  return parseHealthResponse(await response.json());
}
