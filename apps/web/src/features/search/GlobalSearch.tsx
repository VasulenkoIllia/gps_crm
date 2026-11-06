import { searchTooShortText } from "@gps_crm/shared";
import { SearchOutlined } from "@ant-design/icons";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AutoComplete, Input } from "antd";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { errorMessage, useDebouncedValue } from "../../ui";
import { queryOf } from "../subscribers/subscribers.api";
import { fetchSearch, SEARCH_KEY, sectionsOf, type SearchSection } from "./search.api";

// The same words in the header and on the page of the search (manual test 05.11.2026)
export const SEARCH_PLACEHOLDER = "ID, назва, телефон, IMEI, ICCID, SIM";
const MIN_QUERY_LENGTH = 2;
const ALL_RESULTS = "all";
const STATE_LINE = "state";

function optionsOf(sections: SearchSection[]) {
  const targets = new Map<string, string>();
  const groups = sections
    .filter((section) => section.lines.length > 0)
    .map((section) => ({
      label: section.title,
      options: [
        ...section.lines.map((line) => {
          const value = `${section.key}:${line.key}`;
          targets.set(value, line.to);
          return {
            value,
            label: (
              <div className="search-option">
                <div>{line.isArchived ? `${line.title} (в архіві)` : line.title}</div>
                {line.meta && <div className="list-meta">{line.meta}</div>}
              </div>
            ),
          };
        }),
        ...(section.moreTo
          ? [{ value: `${section.key}:more`, label: <span className="list-meta">Показати всі</span> }]
          : []),
      ],
    }));
  for (const section of sections) if (section.moreTo) targets.set(`${section.key}:more`, section.moreTo);
  return { groups, targets };
}

// The one field of the header (search-exports.md A): five of each kind as a person types, Enter for the whole page
export function GlobalSearch({ isLarge = false }: { isLarge?: boolean }) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  // Enter on a chosen line reaches the field as well: the line wins
  const hasChosen = useRef(false);
  const q = useDebouncedValue(text.trim());
  const isReady = q.length >= MIN_QUERY_LENGTH;
  const search = useQuery({
    queryKey: [...SEARCH_KEY, "suggest", q],
    queryFn: ({ signal }) => fetchSearch(q, false, signal),
    enabled: isReady,
    placeholderData: keepPreviousData,
  });
  const { groups, targets } = useMemo(() => optionsOf(search.data ? sectionsOf(search.data, q) : []), [search.data, q]);
  const allResults = `/search${queryOf({ q: text.trim() })}`;
  const state = search.error
    ? errorMessage(search.error)
    : !search.data
      ? "Шукаю"
      : groups.length === 0
        ? (searchTooShortText(q) ?? "Нічого не знайдено")
        : null;
  const options = isReady
    ? [
        ...groups,
        ...(state ? [{ value: STATE_LINE, label: <span className="list-meta">{state}</span>, disabled: true }] : []),
        { value: ALL_RESULTS, label: <span className="list-meta">Усі результати</span> },
      ]
    : [];

  function handleType(value: string) {
    // A line chosen by a click is followed by no Enter: the next one, on a new text, is a plain Enter
    hasChosen.current = false;
    setText(value);
  }

  function go(to: string) {
    setText("");
    void navigate(to);
  }

  function handleSelect(value: string) {
    hasChosen.current = true;
    go(targets.get(value) ?? allResults);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (hasChosen.current) {
      hasChosen.current = false;
      return;
    }
    if (text.trim()) go(allResults);
  }

  return (
    <AutoComplete
      className={isLarge ? "global-search global-search-large" : "global-search"}
      value={text}
      options={options}
      showSearch={{ onSearch: handleType }}
      onSelect={handleSelect}
      onKeyDown={handleKeyDown}
      defaultActiveFirstOption={false}
      // Five lines a group at most: a plain list, so the lines a person sees are the options a screen reader reads
      virtual={false}
      popupMatchSelectWidth={isLarge ? true : 420}
    >
      <Input
        size={isLarge ? "large" : "middle"}
        prefix={<SearchOutlined />}
        placeholder={SEARCH_PLACEHOLDER}
        aria-label="Пошук по системі"
        allowClear
      />
    </AutoComplete>
  );
}
