const CHECK_INTERVAL_MS = 10 * 60 * 1_000;
const TIME_ZONE = "Europe/Kyiv";
const KYIV_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" });
const KYIV_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, dateStyle: "short" });

export function isDueAt(now: Date, hour: number, lastRunDay: string | null): boolean {
  return Number(KYIV_HOUR.format(now)) === hour && KYIV_DAY.format(now) !== lastRunDay;
}

// A stand-in until pg-boss arrives (step 2 of the roadmap): an in-process timer with no history, for a job that is safe
// to run twice or to skip a night. Hours before 03:00 and after 05:00 stay clear of the clock change.
export function scheduleNightly(hour: number, run: () => Promise<void>, onError: (error: unknown) => void): () => void {
  let lastRunDay: string | null = null;
  let isRunning = false;

  const timer = setInterval(() => {
    const now = new Date();
    if (isRunning || !isDueAt(now, hour, lastRunDay)) return;
    isRunning = true;
    run()
      // Marked only after a success: a database away at 02:10 gets another try within the hour
      .then(() => {
        lastRunDay = KYIV_DAY.format(now);
      })
      .catch(onError)
      .finally(() => {
        isRunning = false;
      });
  }, CHECK_INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
