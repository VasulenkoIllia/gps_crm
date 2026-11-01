import { Select } from "antd";
import { FilterField } from "./FilterField";

const ANY_VALUE = "Усі";
const LOAD_FAILED = "Не вдалося завантажити список";

interface FilterSelectProps {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  isLoading?: boolean;
  hasError?: boolean;
  onChange: (value: string | undefined) => void;
}

export function FilterSelect({ label, value, options, isLoading, hasError, onChange }: FilterSelectProps) {
  return (
    <FilterField label={label} hint={hasError ? LOAD_FAILED : null}>
      <Select
        aria-label={label}
        placeholder={ANY_VALUE}
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
