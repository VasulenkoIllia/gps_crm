import { ARCHIVED_STATUS_META, searchTooShortText } from "@gps_crm/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Link } from "react-router";
import { useCan } from "../../lib/session";
import { useUrlFilters } from "../../lib/url-filters";
import {
  EntityLink,
  FilterBar,
  FilterSelect,
  LoadError,
  NoAccess,
  PageHeader,
  Panel,
  SearchField,
  StatusTag,
} from "../../ui";
import { SEARCH_PLACEHOLDER } from "./GlobalSearch";
import { fetchSearch, SEARCH_KEY, sectionsOf, type SearchSection } from "./search.api";

const FILTER_KEYS = ["q", "archived"] as const;
const ARCHIVE_OPTIONS = [{ value: "true", label: "Разом з архівом" }];

function SectionPanel({ section }: { section: SearchSection }) {
  return (
    <Panel title={section.title}>
      <ul className="simple-list">
        {section.lines.map((line) => (
          <li key={line.key}>
            <EntityLink to={line.to}>{line.title}</EntityLink>{" "}
            {line.isArchived && <StatusTag status={ARCHIVED_STATUS_META} />}
            {line.meta && <div className="list-meta">{line.meta}</div>}
          </li>
        ))}
      </ul>
      {section.moreTo && (
        <Link to={section.moreTo} className="panel-link">
          Показати всі
        </Link>
      )}
    </Panel>
  );
}

function Results({ q, withArchive }: { q: string; withArchive: boolean }) {
  const search = useQuery({
    queryKey: [...SEARCH_KEY, "page", q, withArchive],
    queryFn: ({ signal }) => fetchSearch(q, withArchive, signal),
    placeholderData: keepPreviousData,
  });
  if (search.error) return <LoadError error={search.error} onRetry={() => void search.refetch()} />;
  if (!search.data) return <Skeleton active />;
  const found = sectionsOf(search.data, q).filter((section) => section.lines.length > 0);
  if (found.length === 0) {
    return <p className="nothing-found">{searchTooShortText(q) ?? "Нічого не знайдено. Перевірте номер або назву."}</p>;
  }
  return (
    <div className="panel-grid">
      {found.map((section) => (
        <SectionPanel key={section.key} section={section} />
      ))}
    </div>
  );
}

function SearchScreen() {
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(FILTER_KEYS);
  const q = filters.q?.trim() ?? "";
  return (
    <>
      <PageHeader title="Пошук" subtitle="До п'яти записів кожного виду, решта у списках" />
      <Panel>
        <FilterBar hasFilters={hasFilters} onReset={resetFilters}>
          <SearchField
            label="Що шукати"
            placeholder={SEARCH_PLACEHOLDER}
            value={filters.q}
            onChange={(value) => setFilter("q", value)}
          />
          <FilterSelect
            label="Архів"
            value={filters.archived}
            options={ARCHIVE_OPTIONS}
            onChange={(value) => setFilter("archived", value)}
          />
        </FilterBar>
        {!q && (
          <p className="list-meta">
            Шукає за ID чи старим номером клієнта, назвою, телефоном, IMEI, ICCID і номером SIM.
          </p>
        )}
      </Panel>
      {q && <Results q={q} withArchive={filters.archived === "true"} />}
    </>
  );
}

export function SearchPage() {
  const canRead = useCan("subscribers.read");
  return canRead ? <SearchScreen /> : <NoAccess />;
}
