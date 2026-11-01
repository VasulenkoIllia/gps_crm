import type { DbOrTx } from "../../core/db/client.js";
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
