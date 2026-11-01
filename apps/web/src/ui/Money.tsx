import { formatMoney } from "@gps_crm/shared";
import { EMPTY_VALUE } from "../lib/format";

export function Money({ kop }: { kop: number | null | undefined }) {
  if (kop === null || kop === undefined) return <>{EMPTY_VALUE}</>;
  return <span className="money">{formatMoney(kop)}</span>;
}
