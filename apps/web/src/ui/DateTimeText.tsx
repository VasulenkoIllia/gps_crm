import { formatDateTime } from "../lib/dayjs";
import { EMPTY_VALUE } from "../lib/format";

export function DateTimeText({ value }: { value: string | null }) {
  return <>{value ? formatDateTime(value) : EMPTY_VALUE}</>;
}
