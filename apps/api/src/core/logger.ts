import type { FastifyRequest } from "fastify";
import { pino, type DestinationStream, type Logger } from "pino";

const SECRET_KEYS = ["password", "passwordHash", "token", "secret", "apiKey", "cookie", "authorization"];
const REDACTED_PATHS = SECRET_KEYS.flatMap((key) => [key, `*.${key}`]);
const PRISMA_ERROR_PREFIX = "PrismaClient";

// Fastify's request line with the url cut before its query: a token or an email in ?key=value stays out of it.
// Headers are left out on purpose, so a cookie or Authorization never reaches the log.
export function requestLine(request: FastifyRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: request.url.split("?", 1)[0] ?? request.url,
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

// A Prisma error repeats the query arguments in its message and stack: names, phones and IBANs of payers
function serializeError(error: Error): object {
  if (!error.name.startsWith(PRISMA_ERROR_PREFIX)) return pino.stdSerializers.err(error);
  const { code, meta } = error as Error & { code?: string; meta?: { target?: unknown } };
  return { type: error.name, code, target: meta?.target };
}

export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
      serializers: { req: requestLine, err: serializeError },
    },
    destination,
  );
}
