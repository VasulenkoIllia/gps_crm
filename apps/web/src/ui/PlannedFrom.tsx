import { todayKyiv } from "@gps_crm/shared";
import { DateText } from "./DateText";

// D91: a list shows the newest version, and a value of it that has not begun yet carries the day it does
export function PlannedFrom({ value }: { value: string }) {
  if (value <= todayKyiv()) return null;
  return (
    <div className="table-note">
      з <DateText value={value} />
    </div>
  );
}
