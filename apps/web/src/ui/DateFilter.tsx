import { DatePicker } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { DATE_VALUE_FORMAT, isDateValue } from "../lib/dayjs";
import { FilterField } from "./FilterField";

const DISPLAY_FORMAT = "DD.MM.YYYY";
const DISPLAY_HINT = "ДД.ММ.РРРР";

interface DateFilterProps {
  label: string;
  // YYYY-MM-DD, or anything from a hand-edited address, which then shows as empty
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
      <DatePicker
        aria-label={label}
        placeholder={DISPLAY_HINT}
        className="filter-control"
        format={DISPLAY_FORMAT}
        value={value && isDateValue(value) ? dayjs(value) : null}
        disabledDate={isOutside}
        onChange={(date: Dayjs | null) => onChange(date ? date.format(DATE_VALUE_FORMAT) : undefined)}
      />
    </FilterField>
  );
}
