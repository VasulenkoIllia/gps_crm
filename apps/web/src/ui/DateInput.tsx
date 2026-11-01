import { DatePicker, type DatePickerProps } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { DATE_VALUE_FORMAT, isDateValue } from "../lib/dayjs";

const DISPLAY_FORMAT = "DD.MM.YYYY";
const DISPLAY_HINT = "ДД.ММ.РРРР";

interface DateInputProps extends Pick<DatePickerProps, "id" | "className" | "disabled" | "disabledDate"> {
  "aria-label"?: string;
  // YYYY-MM-DD, or anything from a hand-edited address, which then shows as empty
  value?: string;
  onChange?: (value: string | undefined) => void;
}

// A business date as a form holds it: text and not a dayjs object, so it goes to the API as it is
export function DateInput({ value, onChange, ...props }: DateInputProps) {
  return (
    <DatePicker
      {...props}
      placeholder={DISPLAY_HINT}
      format={DISPLAY_FORMAT}
      value={value && isDateValue(value) ? dayjs(value) : null}
      onChange={(date: Dayjs | null) => onChange?.(date ? date.format(DATE_VALUE_FORMAT) : undefined)}
    />
  );
}
