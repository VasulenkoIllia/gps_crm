import type { Dayjs } from "dayjs";
import { isDateValue } from "../lib/dayjs";
import { DateInput } from "./DateInput";
import { FilterField } from "./FilterField";

interface DateFilterProps {
  label: string;
  value: string | undefined;
  min?: string;
  max?: string;
  onChange: (value: string | undefined) => void;
}

// Two of these instead of RangePicker: its two months side by side do not fit a phone
export function DateFilter({ label, value, min, max, onChange }: DateFilterProps) {
  const isOutside = (day: Dayjs) =>
    Boolean(
      (min && isDateValue(min) && day.isBefore(min, "day")) || (max && isDateValue(max) && day.isAfter(max, "day")),
    );
  return (
    <FilterField label={label}>
      <DateInput
        aria-label={label}
        className="filter-control"
        value={value}
        disabledDate={isOutside}
        onChange={onChange}
      />
    </FilterField>
  );
}
