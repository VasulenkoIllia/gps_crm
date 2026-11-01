import { formatPhone } from "@gps_crm/shared";
import { EMPTY_VALUE } from "../lib/format";

// A link, so a press on a phone calls: most of the numbers here are read to be dialled
export function Phone({ value }: { value: string | null | undefined }) {
  if (!value) return <>{EMPTY_VALUE}</>;
  return <a href={`tel:${value}`}>{formatPhone(value)}</a>;
}
