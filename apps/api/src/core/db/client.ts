import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";

// 06-quality.md §6.1: pool and timeouts of the API process
const POOL_MAX_CONNECTIONS = 15;
const CONNECT_TIMEOUT_MS = 5_000;
const STATEMENT_TIMEOUT_MS = 5_000;
// On the client too: the server's statement_timeout never fires on a half-open socket
const QUERY_TIMEOUT_MS = 6_000;
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

export type DbClient = PrismaClient;

// onError gets errors of idle pooled connections (database restart, dropped network);
// without it they would crash the process or go unseen
export function createDbClient(databaseUrl: string, onError: (error: Error) => void): DbClient {
  const adapter = new PrismaPg(
    {
      connectionString: databaseUrl,
      max: POOL_MAX_CONNECTIONS,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      keepAlive: true,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
    },
    { onPoolError: onError, onConnectionError: onError },
  );
  return new PrismaClient({ adapter });
}
