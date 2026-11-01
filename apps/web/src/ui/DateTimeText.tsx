import { formatDateTime } from "../lib/dayjs";

const EMPTY_VALUE = "-";

export function DateTimeText({ value }: { value: string | null }) {
  return <>{value ? formatDateTime(value) : EMPTY_VALUE}</>;
}
