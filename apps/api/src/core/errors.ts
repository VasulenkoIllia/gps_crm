import type { ApiErrorBody } from "@gps_crm/shared";
import type { FastifyInstance, FastifySchemaValidationError } from "fastify";

const CLIENT_ERROR_MIN = 400;
const SERVER_ERROR_MIN = 500;
// The last status Fastify can send
const STATUS_MAX = 599;
const INTERNAL_SERVER_ERROR = 500;

type AppErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 503;

// An expected failure a module raises on purpose: its code and message go to the client as they are, also for 503
export class AppError extends Error {
  readonly statusCode: AppErrorStatus;
  readonly code: string;
  readonly fieldErrors?: Record<string, string>;

  constructor(statusCode: AppErrorStatus, code: string, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

const INTERNAL_ERROR: ApiErrorBody = { code: "internal_error", message: "Сталася помилка сервера. Спробуйте ще раз." };
export const NOT_FOUND_ERROR: ApiErrorBody = { code: "not_found", message: "Не знайдено" };
const CLIENT_ERRORS: Record<number, ApiErrorBody> = {
  401: { code: "unauthorized", message: "Потрібно увійти в систему" },
  403: { code: "forbidden", message: "Немає доступу" },
  404: NOT_FOUND_ERROR,
  405: { code: "method_not_allowed", message: "Цей метод не підтримується" },
  413: { code: "payload_too_large", message: "Завеликий запит" },
  415: { code: "unsupported_media_type", message: "Непідтримуваний формат запиту" },
  429: { code: "too_many_requests", message: "Забагато запитів. Спробуйте пізніше." },
};
const BAD_REQUEST: ApiErrorBody = { code: "bad_request", message: "Некоректний запит" };
const VALIDATION_FAILED: ApiErrorBody = { code: "validation_failed", message: "Перевірте заповнені поля" };
const INVALID_VALUE = "Некоректне значення";

// Fastify sets statusCode on the errors it raises (bad JSON, failed schema check); anything else thrown, or a
// status above 599, is a 500
function statusOf(error: unknown): number {
  if (
    error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= CLIENT_ERROR_MIN &&
    error.statusCode <= STATUS_MAX
  ) {
    return error.statusCode;
  }
  return INTERNAL_SERVER_ERROR;
}

function fieldNameOf(issue: FastifySchemaValidationError): string {
  const path = issue.instancePath.slice(1).replaceAll("/", ".");
  const missing = issue.params.missingProperty;
  return typeof missing === "string" ? [path, missing].filter(Boolean).join(".") : path;
}

function validationIssuesOf(error: unknown): FastifySchemaValidationError[] | undefined {
  if (error instanceof Error && "validation" in error && Array.isArray(error.validation)) {
    return error.validation as FastifySchemaValidationError[];
  }
  return undefined;
}

// A library error may carry a URL or part of a key in its message, so the client gets our own text for its status
function bodyOf(error: unknown, statusCode: number): ApiErrorBody {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, fieldErrors: error.fieldErrors };
  }
  if (statusCode >= SERVER_ERROR_MIN) return INTERNAL_ERROR;
  const issues = validationIssuesOf(error);
  if (issues) {
    const fieldErrors = Object.fromEntries(issues.map((issue) => [fieldNameOf(issue), issue.message ?? INVALID_VALUE]));
    return { ...VALIDATION_FAILED, fieldErrors };
  }
  return CLIENT_ERRORS[statusCode] ?? BAD_REQUEST;
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const statusCode = statusOf(error);
    if (statusCode >= SERVER_ERROR_MIN) request.log.error({ err: error }, "request failed");
    return reply.code(statusCode).send(bodyOf(error, statusCode));
  });
}
