import type { DbOrTx } from "../db/client.js";
import { throttleAddress } from "../http/client-ip.js";
import { deleteThrottles, deleteThrottlesBefore, readThrottles, takeAttempt } from "./throttle.repository.js";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_DAY = 24 * 60 * 60;
const QUIET_MS = 15 * 60 * MS_PER_SECOND;
const STALE_MS = SECONDS_PER_DAY * MS_PER_SECOND;
// A person who mistypes a few times never waits
const FREE_FAILURES = 4;
// П5: a pause with a ceiling. The pause is by email on purpose, so someone who keeps typing wrong passwords also holds
// the right person back while they keep going, at most this long after their last try.
const MAX_DELAY_SECONDS = 60;
// The reset form is public: a letter a minute, and a day's ceiling, so it cannot fill somebody's mailbox
const RESET_LETTER_GAP_SECONDS = 60;
const RESET_LETTERS_PER_DAY = 5;

export const accountKey = (email: string) => `acct:${email}`;
export const pairKey = (email: string, ip: string) => `pair:${email}|${throttleAddress(ip)}`;
export const secondFactorKey = (userId: string) => `2fa:${userId}`;
const resetLetterKey = (userId: string) => `reset:${userId}`;

export function delayAfter(failures: number): number {
  if (failures <= FREE_FAILURES) return 0;
  return Math.min(2 ** (failures - FREE_FAILURES), MAX_DELAY_SECONDS);
}

const SATURATED_AFTER = FREE_FAILURES + Math.ceil(Math.log2(MAX_DELAY_SECONDS));
const DELAYS = Array.from({ length: SATURATED_AFTER }, (_, index) => delayAfter(index + 1));
const RESET_LETTER_DELAYS = Array.from({ length: RESET_LETTERS_PER_DAY }, (_, index) =>
  index + 1 < RESET_LETTERS_PER_DAY ? RESET_LETTER_GAP_SECONDS : SECONDS_PER_DAY,
);

// Worked out from the last failure rather than stored, so two failures at once cannot write a shorter wait over a longer
async function secondsToWait(db: DbOrTx, keys: string[], now: Date): Promise<number> {
  const rows = await readThrottles(db, keys);
  const waits = rows
    .filter((row) => now.getTime() - row.lastFailureAt.getTime() <= QUIET_MS)
    .map((row) => row.lastFailureAt.getTime() + delayAfter(row.failures) * MS_PER_SECOND - now.getTime());
  return Math.max(0, Math.ceil(Math.max(0, ...waits) / MS_PER_SECOND));
}

// A try counts before it is checked, and a right one clears the counters afterwards. Returns the seconds to wait when
// the pause still runs, 0 when the caller may go on.
export async function claimAttempt(db: DbOrTx, keys: string[], now = new Date()): Promise<number> {
  const quietSince = new Date(now.getTime() - QUIET_MS);
  for (const key of keys) {
    // At least 1: a counter cleared in between must not read as «go on» for a try that was refused
    if (!(await takeAttempt(db, key, now, quietSince, DELAYS))) return Math.max(1, await secondsToWait(db, keys, now));
  }
  return 0;
}

export function claimResetLetter(db: DbOrTx, userId: string, now = new Date()): Promise<boolean> {
  const quietSince = new Date(now.getTime() - STALE_MS);
  return takeAttempt(db, resetLetterKey(userId), now, quietSince, RESET_LETTER_DELAYS);
}

export function clearFailures(db: DbOrTx, keys: string[]): Promise<void> {
  return deleteThrottles(db, keys);
}

export function deleteStaleThrottles(db: DbOrTx, now = new Date()): Promise<number> {
  return deleteThrottlesBefore(db, new Date(now.getTime() - STALE_MS));
}
