// The histories of 03-data-model.md §3.4: [validFrom, validTo), dates as text, which compare as they read (dates.ts)
export interface DatedPeriod {
  id: string;
  validFrom: string;
  validTo: string | null;
}

// A version replaced before it began stays as an empty period [X, X): on record, in force on no day at all (D61)
export function isLivePeriod(period: Pick<DatedPeriod, "validFrom" | "validTo">): boolean {
  return period.validTo === null || period.validTo > period.validFrom;
}

export function periodOn<T extends Pick<DatedPeriod, "validFrom" | "validTo">>(periods: T[], date: string): T | null {
  return (
    periods.find(
      (period) =>
        isLivePeriod(period) && period.validFrom <= date && (period.validTo === null || date < period.validTo),
    ) ?? null
  );
}

// The version planned after a date: the earliest live one that has not begun by then
export function periodAfter<T extends Pick<DatedPeriod, "validFrom" | "validTo">>(
  periods: T[],
  date: string,
): T | null {
  const planned = periods.filter((period) => isLivePeriod(period) && period.validFrom > date);
  return planned.reduce<T | null>(
    (first, period) => (first && first.validFrom <= period.validFrom ? first : period),
    null,
  );
}

// D91: the day the value of the newest live version took over. A version that only repeats it (a new payer under the same
// tariff) does not move the day, so a list marks a value as planned only when that value is not in force yet.
export function valueSince<T extends Pick<DatedPeriod, "validFrom" | "validTo">>(
  periods: T[],
  isSameValue: (one: T, other: T) => boolean,
): string | null {
  const live = periods.filter(isLivePeriod).sort((a, b) => b.validFrom.localeCompare(a.validFrom));
  const [newest] = live;
  if (!newest) return null;
  let since = newest.validFrom;
  for (const period of live.slice(1)) {
    if (!isSameValue(period, newest)) break;
    since = period.validFrom;
  }
  return since;
}

export interface VersionPlan<T> {
  // A version that has begun and starts later than the new one: the past is not rewritten (objects.md П12)
  blockedBy: T | null;
  closings: { id: string; validTo: string }[];
}

// What a new version from `validFrom` does to the ones before it. A version that has not begun, and one of the same date,
// closes on its own start. The one in force closes on the new date.
export function planVersion<T extends DatedPeriod>(periods: T[], validFrom: string, today: string): VersionPlan<T> {
  const live = periods.filter(isLivePeriod);
  const blockedBy = live.find((period) => period.validFrom > validFrom && period.validFrom <= today) ?? null;
  const closings: { id: string; validTo: string }[] = [];
  for (const { id, validFrom: start, validTo } of live) {
    if (start >= validFrom) closings.push({ id, validTo: start });
    else if (validTo === null || validTo > validFrom) closings.push({ id, validTo: validFrom });
  }
  return { blockedBy, closings };
}
