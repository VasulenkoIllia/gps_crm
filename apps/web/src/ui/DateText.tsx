import { formatDate } from "../lib/dayjs";
import { EMPTY_VALUE } from "../lib/format";

// A business date, YYYY-MM-DD: for a moment in time there is DateTimeText
export function DateText({ value }: { value: string | null | undefined }) {
  return <>{value ? formatDate(value) : EMPTY_VALUE}</>;
}
