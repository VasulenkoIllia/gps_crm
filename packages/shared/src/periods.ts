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
