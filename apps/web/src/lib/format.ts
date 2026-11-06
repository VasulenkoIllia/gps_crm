export const EMPTY_VALUE = "-";

const BYTES_IN_UNIT = 1024;
const BYTE_UNITS = ["Б", "КБ", "МБ", "ГБ", "ТБ"] as const;
const SIZE_FORMAT = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= BYTES_IN_UNIT && unit < BYTE_UNITS.length - 1) {
    value /= BYTES_IN_UNIT;
    unit += 1;
  }
  return `${SIZE_FORMAT.format(value)} ${BYTE_UNITS[unit] ?? ""}`;
}

const DIGIT_GROUP = 4;

// IMEI, ICCID: groups of four from the start, so a long number reads and compares by eye (05-ui-standard.md §5.7)
export function digitGroups(value: string): string[] {
  const groups: string[] = [];
  for (let start = 0; start < value.length; start += DIGIT_GROUP) groups.push(value.slice(start, start + DIGIT_GROUP));
  return groups;
}
