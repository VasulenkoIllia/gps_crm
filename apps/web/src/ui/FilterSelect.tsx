import { Select } from "antd";
import { FilterField } from "./FilterField";

const ANY_VALUE = "Усі";

// Without a choice a list shows the records outside the archive, and the empty filter has to say so
export const ARCHIVE_FILTER = { options: [{ value: "true", label: "Лише архівні" }], anyLabel: "Без архівних" };
const LOAD_FAILED = "Не вдалося завантажити список";

interface FilterSelectProps {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  isLoading?: boolean;
  hasError?: boolean;
  onChange: (value: string | undefined) => void;
  // What no choice means, when it is not «all»
  anyLabel?: string;
}

export function FilterSelect(props: FilterSelectProps) {
  const { label, value, options, isLoading, hasError, onChange, anyLabel = ANY_VALUE } = props;
  return (
    <FilterField label={label} hint={hasError ? LOAD_FAILED : null}>
      <Select
        aria-label={label}
        placeholder={anyLabel}
        className="filter-control"
        value={value}
        options={options}
        loading={isLoading}
        status={hasError ? "error" : undefined}
        allowClear
        showSearch={{ optionFilterProp: "label" }}
        popupMatchSelectWidth={false}
        onChange={(next: string | undefined) => onChange(next)}
      />
    </FilterField>
  );
}
