import type { DbOrTx } from "../../core/db/client.js";
import type { JobDefinition } from "../../core/jobs/job.js";
import { deleteDeadSessions } from "../../core/session/session.repository.js";
import { deleteStaleThrottles } from "../../core/throttle/throttle.js";
import { deleteDeadTokens } from "../users/index.js";

// Plain deletes of what is already dead, so a repeat or a skipped night changes nothing
export async function runAuthCleanup(db: DbOrTx): Promise<{ sessions: number; tokens: number; throttles: number }> {
  return {
    sessions: await deleteDeadSessions(db),
    tokens: await deleteDeadTokens(db),
    throttles: await deleteStaleThrottles(db),
  };
}

// Three nights of silence: one missed night is nothing to worry about, and a retry may land in the next day
const MAX_SILENCE_MS = 3 * 24 * 60 * 60 * 1_000;

export const AUTH_CLEANUP_JOB: JobDefinition = {
  name: "auth.cleanup",
  title: "Прибирання завершених сесій і токенів",
  cron: "0 2 * * *",
  scheduleLabel: "Щоночі о 02:00",
  maxSilenceMs: MAX_SILENCE_MS,
  canRunByHand: true,
  run: async ({ db }) => ({ summary: await runAuthCleanup(db) }),
};
