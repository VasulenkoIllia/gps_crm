import dayjs from "dayjs";
import "dayjs/locale/uk";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

// Dates of the system are Kyiv dates, whatever the device's zone: 05-ui-standard.md
const APP_TIME_ZONE = "Europe/Kyiv";
const DATE_TIME_FORMAT = "DD.MM.YYYY HH:mm";
export const DATE_VALUE_FORMAT = "YYYY-MM-DD";
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(APP_TIME_ZONE);
dayjs.locale("uk");

export function formatDateTime(value: string): string {
  return dayjs(value).tz().format(DATE_TIME_FORMAT);
}

// A business date has no zone to convert, so it is only turned around
export function formatDate(value: string): string {
  return value.split("-").reverse().join(".");
}

// Strict: dayjs alone would roll a thirteenth month over into the next year
export function isDateValue(value: string): boolean {
  return DATE_VALUE.test(value) && dayjs.utc(value).format(DATE_VALUE_FORMAT) === value;
}

export function startOfDay(date: string): string {
  return dayjs.tz(date).toISOString();
}

// Counts days on the plain date, so a day of the clock change, 23 or 25 hours long, still ends at midnight
export function startOfNextDay(date: string): string {
  return startOfDay(dayjs.utc(date).add(1, "day").format(DATE_VALUE_FORMAT));
}
