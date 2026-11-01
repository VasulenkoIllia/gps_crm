import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../../generated/prisma/client.js";

const CONNECT_TIMEOUT_MS = 5_000;
// On the client too: the server's statement_timeout never fires on a half-open socket
const CLIENT_TIMEOUT_MARGIN_MS = 1_000;

interface DbProfile {
  maxConnections: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
}

// 06-quality.md §6.1. A request answers in seconds or it has failed; a background job does its work in batches, each
// of which may take minutes, and pg-boss runs one job at a time per queue, so it needs few connections.
export const DB_PROFILES = {
  api: { maxConnections: 15, statementTimeoutMs: 5_000, idleInTransactionTimeoutMs: 30_000 },
  worker: { maxConnections: 5, statementTimeoutMs: 300_000, idleInTransactionTimeoutMs: 60_000 },
} as const satisfies Record<string, DbProfile>;

export type DbClient = PrismaClient;
// What a repository takes, so one function works inside a service's transaction and outside it
export type DbOrTx = PrismaClient | Prisma.TransactionClient;

const UNIQUE_VIOLATION = "P2002";
const INVALID_BYTE_SEQUENCE = "22021";

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION;
}

// PostgreSQL refuses a NUL inside a text, and it is the first to look: a schema takes it for an ordinary character
export function isInvalidText(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const driverError = error.meta?.driverAdapterError as { cause?: { originalCode?: string } } | undefined;
  return driverError?.cause?.originalCode === INVALID_BYTE_SEQUENCE;
}

// onError gets errors of idle pooled connections (database restart, dropped network);
// without it they would crash the process or go unseen
// Every statement that reaches PostgreSQL, relation loads included: what a page of a list really costs. For the tests of
// 06-quality.md §6.1: the app has no use for it.
export function createStatementLog(databaseUrl: string): { db: DbClient; statements: string[] } {
  const statements: string[] = [];
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const db = new PrismaClient({ adapter, log: [{ emit: "event", level: "query" }] });
  db.$on("query", ({ query }) => statements.push(query));
  return { db, statements };
}

export function createDbClient(
  databaseUrl: string,
  onError: (error: Error) => void,
  profile: DbProfile = DB_PROFILES.api,
): DbClient {
  const adapter = new PrismaPg(
    {
      connectionString: databaseUrl,
      max: profile.maxConnections,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      keepAlive: true,
      statement_timeout: profile.statementTimeoutMs,
      query_timeout: profile.statementTimeoutMs + CLIENT_TIMEOUT_MARGIN_MS,
      idle_in_transaction_session_timeout: profile.idleInTransactionTimeoutMs,
    },
    { onPoolError: onError, onConnectionError: onError },
  );
  return new PrismaClient({ adapter });
}
