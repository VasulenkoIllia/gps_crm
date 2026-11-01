import { Select } from "antd";
import { chooseableOptions, type DictOption } from "./dict-options";

const PLACEHOLDER = "Оберіть зі списку";
const LOADING = "Завантаження";
const LOAD_FAILED = "Не вдалося завантажити список";

interface DictSelectProps<V extends string | string[]> {
  id?: string;
  "aria-label"?: string;
  value?: V;
  onChange?: (value: V) => void;
  options: DictOption[];
  isMultiple?: boolean;
  isLoading?: boolean;
  hasError?: boolean;
  disabled?: boolean;
}

export function DictSelect<V extends string | string[]>(props: DictSelectProps<V>) {
  const { value, options, isMultiple, isLoading, hasError, ...select } = props;
  return (
    <Select
      {...select}
      value={value}
      mode={isMultiple ? "multiple" : undefined}
      options={chooseableOptions(options, value)}
      placeholder={hasError ? LOAD_FAILED : PLACEHOLDER}
      status={hasError ? "error" : undefined}
      loading={isLoading}
      // Until the list is here a chosen value has only its id to show, which means nothing to a person
      labelRender={({ label }) => label ?? (hasError ? LOAD_FAILED : LOADING)}
      showSearch={{ optionFilterProp: "label" }}
      // A short list, and only without the virtual list the options a person sees are options for a screen reader
      virtual={false}
    />
  );
}
