import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { useMemo, useState } from "react";
import { REMOTE_SELECT_KEY } from "../lib/query-client";
import { useDebouncedValue } from "./useDebouncedValue";

const PLACEHOLDER = "Почніть вводити";
const NOTHING_FOUND = "Нічого не знайдено";
const LOAD_FAILED = "Не вдалося завантажити список";

export interface RemoteOption {
  value: string;
  label: string;
}

interface RemoteSelectProps {
  id?: string;
  "aria-label"?: string;
  // Goes into the key of the query: one per kind of record
  name: string;
  value?: string;
  // The value chosen before this page: the search has not seen it, and an id means nothing to a person
  chosenLabel?: string;
  className?: string;
  allowClear?: boolean;
  search: (text: string, signal: AbortSignal) => Promise<RemoteOption[]>;
  onChange?: (value: string | undefined) => void;
}

// The server does the search: a list of a million does not come to the browser (05-ui-standard.md §5.2)
export function RemoteSelect(props: RemoteSelectProps) {
  const { name, value, chosenLabel, search, ...select } = props;
  const [text, setText] = useState("");
  const settled = useDebouncedValue(text.trim());
  const found = useQuery({
    queryKey: [...REMOTE_SELECT_KEY, name, settled],
    queryFn: ({ signal }) => search(settled, signal),
    placeholderData: keepPreviousData,
  });
  const options = useMemo(() => {
    const rows = found.data ?? [];
    const isShown = !value || !chosenLabel || rows.some((row) => row.value === value);
    return isShown ? rows : [{ value, label: chosenLabel }, ...rows];
  }, [found.data, value, chosenLabel]);

  return (
    <Select
      {...select}
      value={value}
      options={options}
      placeholder={PLACEHOLDER}
      loading={found.isFetching}
      status={found.isError ? "error" : undefined}
      notFoundContent={found.isError ? LOAD_FAILED : NOTHING_FOUND}
      popupMatchSelectWidth={false}
      showSearch={{ filterOption: false, onSearch: setText }}
      onChange={(next: string | undefined) => props.onChange?.(next)}
    />
  );
}
