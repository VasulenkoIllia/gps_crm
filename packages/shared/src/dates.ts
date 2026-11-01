import { z } from "zod";

const APP_TIME_ZONE = "Europe/Kyiv";
const INVALID_DATE = "Вкажіть дату";
// PostgreSQL has no year 0, and a typo in the year should not become a price from the year 20270
const BUSINESS_DATE_MIN = "2000-01-01";
const BUSINESS_DATE_MAX = "2100-01-01";
const MONTHS_IN_YEAR = 12;
const MONTH_DIGITS = 2;

const KYIV_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// A business date is plain text, YYYY-MM-DD: it has no zone, and such dates compare as strings (03-data-model.md §3.1)
export function todayKyiv(now: Date = new Date()): string {
  const parts = Object.fromEntries(KYIV_DATE.formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// The default «діє з» of a price (references.md П3)
export function firstOfNextMonth(date: string): string {
  const [year = 0, month = 0] = date.split("-").map(Number);
  const next = month === MONTHS_IN_YEAR ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return `${next.year}-${String(next.month).padStart(MONTH_DIGITS, "0")}-01`;
}

export const businessDateSchema = z.iso
  .date({ error: INVALID_DATE })
  .refine((date) => date >= BUSINESS_DATE_MIN && date < BUSINESS_DATE_MAX, INVALID_DATE);
