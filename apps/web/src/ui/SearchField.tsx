import { Input } from "antd";
import { useEffect, useState } from "react";
import { FilterField } from "./FilterField";
import { SEARCH_DELAY_MS } from "./useDebouncedValue";

interface SearchFieldProps {
  label: string;
  placeholder?: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

// The filter a list starts with: on the server, 300 ms after the last letter (05-ui-standard.md §5.2)
export function SearchField({ label, placeholder, value, onChange }: SearchFieldProps) {
  const [text, setText] = useState(value ?? "");
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  // Follows the address, which Back changes past this field. In render, not in an effect, so the old text never shows.
  // What this field sent itself is only the address catching up: a letter or a space typed since must stay.
  if (seen !== value) {
    setSeen(value);
    if (value !== sent) {
      setSent(value);
      setText(value ?? "");
    }
  }
  useEffect(() => {
    const wanted = text.trim() || undefined;
    if (wanted === value) return;
    const timer = setTimeout(() => {
      setSent(wanted);
      onChange(wanted);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  return (
    <FilterField label={label}>
      <Input.Search
        aria-label={label}
        className="filter-control filter-search"
        placeholder={placeholder}
        value={text}
        allowClear
        onChange={(event) => setText(event.target.value)}
      />
    </FilterField>
  );
}
