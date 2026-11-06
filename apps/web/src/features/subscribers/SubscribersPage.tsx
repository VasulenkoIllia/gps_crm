import {
  SUBSCRIBER_SORTS,
  SUBSCRIBER_STATUS_FILTER_META,
  SUBSCRIBER_TYPE_SHORT,
  SUBSCRIBER_TYPES,
  subscriberStatusMeta,
  type SubscriberListItem,
} from "@gps_crm/shared";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { listRows } from "../../lib/list-rows";
import { useCan } from "../../lib/session";
import { chosenCount, useUrlFilters, useUrlSort } from "../../lib/url-filters";
import {
  ARCHIVE_FILTER,
  EntityLink,
  FilterBar,
  FilterSelect,
  ListPage,
  NoAccess,
  NothingFound,
  PlannedFrom,
  SearchField,
  StatusTag,
  type DataTableColumn,
} from "../../ui";
import { ExportButton } from "../exports/ExportButton";
import { useReferenceOptions } from "../references/references.api";
import { tariffLabel, useManagerOptions } from "./subscriber-form";
import { SubscriberCreateDrawer } from "./SubscriberCreateDrawer";
import {
  fetchSubscriberCount,
  fetchSubscribers,
  SUBSCRIBER_FILTER_KEYS,
  SUBSCRIBERS_KEY,
  type SubscriberFilters,
} from "./subscribers.api";

const SEARCH_HINT = "Назва, ID, старий номер, ЄДРПОУ, телефон, email, IMEI, SIM";
const STATUS_OPTIONS = Object.entries(SUBSCRIBER_STATUS_FILTER_META).map(([value, { label }]) => ({ value, label }));
const TYPE_OPTIONS = Object.entries(SUBSCRIBER_TYPES).map(([value, label]) => ({ value, label }));

const COLUMNS: DataTableColumn<SubscriberListItem>[] = [
  {
    title: "Назва",
    key: "name",
    sorter: true,
    render: (_, row) => (
      <>
        <EntityLink to={`/subscribers/${row.id}`}>{row.name}</EntityLink>
        {row.taxId && (
          <div className="table-note">
            {row.type === "B2C" ? "ІПН" : "ЄДРПОУ"} {row.taxId}
          </div>
        )}
      </>
    ),
  },
  {
    title: "ID",
    key: "code",
    sorter: true,
    render: (_, row) => (
      <>
        {row.code}
        {row.legacyCode && <div className="table-note">стар. {row.legacyCode}</div>}
      </>
    ),
  },
  { title: "Тип", key: "type", render: (_, row) => SUBSCRIBER_TYPE_SHORT[row.type] },
  {
    title: "Статус",
    key: "status",
    render: (_, row) => <StatusTag status={subscriberStatusMeta(row.status, row.objectsTotal, row.isArchived)} />,
  },
  {
    title: "Програма й тариф",
    key: "tariff",
    render: (_, row) => (
      <>
        {row.programName}
        <div className="table-note">{row.tariffName}</div>
        <PlannedFrom value={row.tariffFrom} />
      </>
    ),
  },
  {
    title: "Об'єкти",
    key: "objects",
    align: "right",
    sorter: true,
    // Active of all: «1 / 2» alone read as nothing (manual test 05.11.2026)
    render: (_, row) => (
      <span title="Активні з усіх об'єктів клієнта">
        {row.objectsActive} з {row.objectsTotal}
        <div className="table-note">активні</div>
      </span>
    ),
  },
  { title: "Менеджер", dataIndex: "managerName" },
];

interface ListFiltersProps {
  filters: SubscriberFilters;
  hasFilters: boolean;
  onChange: (key: keyof SubscriberFilters, value: string | undefined) => void;
  onReset: () => void;
}

// The rest of the filters behind «Ще фільтри»: on a phone the list starts on the first screen (manual test 05.11.2026)
const MORE_FILTERS = ["type", "tariffId", "archived"] as const;

function ListFilters({ filters, hasFilters, onChange, onReset }: ListFiltersProps) {
  const programs = useReferenceOptions("programs", true);
  const tariffs = useReferenceOptions("tariffs", true);
  const managers = useManagerOptions(true);
  const tariffOptions = useMemo(
    () => (tariffs.items ?? []).map((tariff) => ({ value: tariff.id, label: tariffLabel(tariff) })),
    [tariffs.items],
  );
  return (
    <FilterBar
      hasFilters={hasFilters}
      onReset={onReset}
      moreChosen={chosenCount(filters, MORE_FILTERS)}
      more={
        <>
          <FilterSelect
            label="Тип"
            value={filters.type}
            options={TYPE_OPTIONS}
            onChange={(value) => onChange("type", value)}
          />
          <FilterSelect
            label="Тариф"
            value={filters.tariffId}
            options={tariffOptions}
            isLoading={tariffs.isLoading}
            hasError={tariffs.hasError}
            onChange={(value) => onChange("tariffId", value)}
          />
          <FilterSelect
            label="Архів"
            value={filters.archived}
            options={ARCHIVE_FILTER.options}
            anyLabel={ARCHIVE_FILTER.anyLabel}
            onChange={(value) => onChange("archived", value)}
          />
        </>
      }
    >
      <SearchField
        label="Пошук"
        placeholder={SEARCH_HINT}
        value={filters.q}
        onChange={(value) => onChange("q", value)}
      />
      <FilterSelect
        label="Статус"
        value={filters.status}
        options={STATUS_OPTIONS}
        onChange={(value) => onChange("status", value)}
      />
      <FilterSelect
        label="Програма"
        value={filters.programId}
        options={programs.options}
        isLoading={programs.isLoading}
        hasError={programs.hasError}
        onChange={(value) => onChange("programId", value)}
      />
      <FilterSelect
        label="Менеджер"
        value={filters.managerId}
        options={managers.options}
        isLoading={managers.isLoading}
        hasError={managers.hasError}
        onChange={(value) => onChange("managerId", value)}
      />
    </FilterBar>
  );
}

function countText(count: number, isCapped: boolean): string {
  return isCapped ? `Понад ${count} клієнтів` : `Клієнтів: ${count}`;
}

function SubscribersScreen() {
  const navigate = useNavigate();
  const canWrite = useCan("subscribers.write");
  const [isCreating, setCreating] = useState(false);
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(SUBSCRIBER_FILTER_KEYS);
  const { sort, applySort } = useUrlSort(SUBSCRIBER_SORTS);

  const pages = useInfiniteQuery({
    queryKey: [...SUBSCRIBERS_KEY, "list", filters, sort],
    queryFn: ({ pageParam, signal }) =>
      fetchSubscribers({ filters, sort: sort?.key, order: sort?.order, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  });
  const count = useQuery({
    queryKey: [...SUBSCRIBERS_KEY, "count", filters],
    queryFn: ({ signal }) => fetchSubscriberCount(filters, signal),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => listRows(pages.data, pages.isPlaceholderData), [pages.data, pages.isPlaceholderData]);

  return (
    <>
      <ListPage
        title="Клієнти"
        subtitle={count.data && countText(count.data.count, count.data.isCapped)}
        actions={
          <>
            {canWrite && (
              <Button type="primary" onClick={() => setCreating(true)}>
                Новий клієнт
              </Button>
            )}
            <ExportButton request={{ entity: "subscribers", filters, sort: sort?.key, order: sort?.order }} />
          </>
        }
        filters={<ListFilters filters={filters} hasFilters={hasFilters} onChange={setFilter} onReset={resetFilters} />}
        table={{
          rows,
          columns: COLUMNS,
          rowKey: "id",
          error: pages.error,
          empty: hasFilters ? <NothingFound onReset={resetFilters} q={filters.q} /> : "Клієнтів ще немає",
          onRetry: () => void pages.refetch(),
          hasMore: pages.hasNextPage && !pages.isPlaceholderData,
          isLoadingMore: pages.isFetchingNextPage,
          onLoadMore: () => void pages.fetchNextPage(),
          sort,
          onSort: applySort,
          onRowClick: (row) => void navigate(`/subscribers/${row.id}`),
        }}
      />
      <SubscriberCreateDrawer open={isCreating} onClose={() => setCreating(false)} />
    </>
  );
}

export function SubscribersPage() {
  const canRead = useCan("subscribers.read");
  return canRead ? <SubscribersScreen /> : <NoAccess />;
}
