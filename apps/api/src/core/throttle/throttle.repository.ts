import type { DbOrTx } from "../db/client.js";

export interface ThrottleRow {
  key: string;
  failures: number;
  lastFailureAt: Date;
}

export function readThrottles(db: DbOrTx, keys: string[]): Promise<ThrottleRow[]> {
  return db.signInThrottle.findMany({
    where: { key: { in: keys } },
    select: { key: true, failures: true, lastFailureAt: true },
  });
}

// One statement that both checks the pause and counts the try, so a wave of parallel guesses cannot all see «no pause»
// while they queue for argon2. `delays[n]` is the pause after n failures, the last value holds for every n past it.
// A key quiet since `quietSince` starts again from one. False when the pause still runs. GREATEST, because the clocks of
// two parallel requests differ by milliseconds, and a free try must not fall on that.
export async function takeAttempt(
  db: DbOrTx,
  key: string,
  now: Date,
  quietSince: Date,
  delays: number[],
): Promise<boolean> {
  const taken = await db.$executeRaw`
    INSERT INTO sign_in_throttle (key, failures, first_failure_at, last_failure_at)
    VALUES (${key}, 1, ${now}, ${now})
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN sign_in_throttle.last_failure_at < ${quietSince} THEN 1
                      ELSE sign_in_throttle.failures + 1 END,
      first_failure_at = CASE WHEN sign_in_throttle.last_failure_at < ${quietSince} THEN EXCLUDED.first_failure_at
                              ELSE sign_in_throttle.first_failure_at END,
      last_failure_at = EXCLUDED.last_failure_at
    WHERE sign_in_throttle.last_failure_at + make_interval(
      secs => (${delays}::int[])[LEAST(sign_in_throttle.failures, ${delays.length})]
    ) <= GREATEST(${now}::timestamptz, sign_in_throttle.last_failure_at)
  `;
  return taken === 1;
}

export async function deleteThrottles(db: DbOrTx, keys: string[]): Promise<void> {
  await db.signInThrottle.deleteMany({ where: { key: { in: keys } } });
}

export async function deleteThrottlesBefore(db: DbOrTx, before: Date): Promise<number> {
  const { count } = await db.signInThrottle.deleteMany({ where: { lastFailureAt: { lt: before } } });
  return count;
}
