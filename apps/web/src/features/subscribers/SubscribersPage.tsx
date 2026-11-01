import {
  SORT_ORDERS,
  SUBSCRIBER_SORTS,
  SUBSCRIBER_STATUS_META,
  SUBSCRIBER_TYPES,
  ARCHIVED_STATUS_META,
  type SortOrder,
  type SubscriberListItem,
  type SubscriberSort,
} from "@gps_crm/shared";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { listRows } from "../../lib/list-rows";
import { useCan } from "../../lib/session";
import { useUrlFilters } from "../../lib/url-filters";
import {
  EntityLink,
  FilterBar,
  FilterSelect,
  ListPage,
  NoAccess,
  NothingFound,
  SearchField,
  StatusTag,
  type DataTableColumn,
  type TableSort,
} from "../../ui";
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

const SEARCH_HINT = "Назва, ID, старий номер, ЄДРПОУ, телефон, email";
const SORT_PARAM = "sort";
const ORDER_PARAM = "order";
const STATUS_OPTIONS = Object.entries(SUBSCRIBER_STATUS_META).map(([value, { label }]) => ({ value, label }));
const TYPE_OPTIONS = Object.entries(SUBSCRIBER_TYPES).map(([value, label]) => ({ value, label }));
const ARCHIVE_OPTIONS = [{ value: "true", label: "В архіві" }];

const COLUMNS: DataTableColumn<SubscriberListItem>[] = [
  {
    title: "ID",
    key: "code",
    sorter: true,
    render: (_, row) => (
      <>
        <EntityLink to={`/subscribers/${row.id}`}>{row.code}</EntityLink>
        {row.legacyCode && <div className="table-note">{row.legacyCode}</div>}
      </>
    ),
  },
  {
    title: "Назва",
    key: "name",
    sorter: true,
    render: (_, row) => (
      <>
        {row.name}
        {row.taxId && <div className="table-note">{row.taxId}</div>}
      </>
    ),
  },
  { title: "Тип", dataIndex: "type" },
  {
    title: "Статус",
    key: "status",
    render: (_, row) => (
      <StatusTag status={row.isArchived ? ARCHIVED_STATUS_META : SUBSCRIBER_STATUS_META[row.status]} />
    ),
  },
  {
    title: "Програма й тариф",
    key: "tariff",
    render: (_, row) => (
      <>
        {row.programName}
        <div className="table-note">{row.tariffName}</div>
      </>
    ),
  },
  {
    title: "Об'єкти",
    key: "objects",
    align: "right",
    sorter: true,
    render: (_, row) => `${row.objectsActive} / ${row.objectsTotal}`,
  },
  { title: "Менеджер", dataIndex: "managerName" },
];

function readSort(params: URLSearchParams): TableSort | undefined {
  const key = SUBSCRIBER_SORTS.find((sort: SubscriberSort) => sort === params.get(SORT_PARAM));
  const order = SORT_ORDERS.find((value: SortOrder) => value === params.get(ORDER_PARAM)) ?? "asc";
  return key ? { key, order } : undefined;
}

interface ListFiltersProps {
  filters: SubscriberFilters;
  hasFilters: boolean;
  onChange: (key: keyof SubscriberFilters, value: string | undefined) => void;
  onReset: () => void;
}

function ListFilters({ filters, hasFilters, onChange, onReset }: ListFiltersProps) {
  const programs = useReferenceOptions("programs", true);
  const tariffs = useReferenceOptions("tariffs", true);
  const managers = useManagerOptions(true);
  const tariffOptions = useMemo(
    () => (tariffs.items ?? []).map((tariff) => ({ value: tariff.id, label: tariffLabel(tariff) })),
    [tariffs.items],
  );
  return (
    <FilterBar hasFilters={hasFilters} onReset={onReset}>
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
        label="Тип"
        value={filters.type}
        options={TYPE_OPTIONS}
        onChange={(value) => onChange("type", value)}
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
        label="Тариф"
        value={filters.tariffId}
        options={tariffOptions}
        isLoading={tariffs.isLoading}
        hasError={tariffs.hasError}
        onChange={(value) => onChange("tariffId", value)}
      />
      <FilterSelect
        label="Менеджер"
        value={filters.managerId}
        options={managers.options}
        isLoading={managers.isLoading}
        hasError={managers.hasError}
        onChange={(value) => onChange("managerId", value)}
      />
      <FilterSelect
        label="Архів"
        value={filters.archived}
        options={ARCHIVE_OPTIONS}
        onChange={(value) => onChange("archived", value)}
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
  const [params, setParams] = useSearchParams();
  const sort = useMemo(() => readSort(params), [params]);

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

  function applySort(next: TableSort | null) {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.delete(SORT_PARAM);
        updated.delete(ORDER_PARAM);
        if (next) {
          updated.set(SORT_PARAM, next.key);
          updated.set(ORDER_PARAM, next.order);
        }
        return updated;
      },
      { replace: true },
    );
  }

  return (
    <>
      <ListPage
        title="Клієнти"
        subtitle={count.data && countText(count.data.count, count.data.isCapped)}
        actions={
          canWrite && (
            <Button type="primary" onClick={() => setCreating(true)}>
              Новий клієнт
            </Button>
          )
        }
        filters={<ListFilters filters={filters} hasFilters={hasFilters} onChange={setFilter} onReset={resetFilters} />}
        table={{
          rows,
          columns: COLUMNS,
          rowKey: "id",
          error: pages.error,
          empty: hasFilters ? <NothingFound onReset={resetFilters} /> : "Клієнтів ще немає",
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
