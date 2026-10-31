import type { FastifyInstance } from "fastify";

// Below stop_grace_period in infra/compose.yml, so the app exits on its own before Docker kills it
const SHUTDOWN_TIMEOUT_MS = 25_000;
const IDLE_SWEEP_MS = 500;
const FAILURE_EXIT_CODE = 1;

// The order is the point (06-quality.md §6.3): the server finishes its requests, only then do their dependencies go
export async function stopApp(app: FastifyInstance, closeDependencies: () => Promise<void>): Promise<void> {
  // A keep-alive connection that goes idle during close would hold it open until its timeout
  const sweep = setInterval(() => app.server.closeIdleConnections(), IDLE_SWEEP_MS);
  await app.close();
  clearInterval(sweep);
  await closeDependencies();
}

// process.on with a flag, not once: Ctrl+C in npm run dev also brings the signal that npm and Node's watch mode
// pass on, which would kill the app halfway through closing
export function installShutdown(app: FastifyInstance, closeDependencies: () => Promise<void>): void {
  let isShuttingDown = false;

  function stop(reason: string, exitCode: number): void {
    if (isShuttingDown) return;
    isShuttingDown = true;
    app.log.info({ reason }, "shutting down");
    setTimeout(() => {
      app.log.error("shutdown timed out, forcing exit");
      process.exit(FAILURE_EXIT_CODE);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    stopApp(app, closeDependencies).then(
      () => process.exit(exitCode),
      (error: unknown) => {
        app.log.error({ err: error }, "shutdown failed");
        process.exit(FAILURE_EXIT_CODE);
      },
    );
  }

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => stop(signal, 0));
  }
  // Without these a crash skips pino and the shutdown: a raw stack in stderr, requests cut, the pool left open
  for (const event of ["uncaughtException", "unhandledRejection"] as const) {
    process.on(event, (error: unknown) => {
      app.log.fatal({ err: error }, event);
      stop(event, FAILURE_EXIT_CODE);
    });
  }
}
