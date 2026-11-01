import { OBJECT_SORTS, OBJECT_STATUS_META } from "@gps_crm/shared";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { listRows } from "../../lib/list-rows";
import { useCan } from "../../lib/session";
import { useUrlFilters, useUrlSort } from "../../lib/url-filters";
import { FilterBar, FilterSelect, ListPage, NoAccess, NothingFound, SearchField } from "../../ui";
import { useReferenceOptions } from "../references/references.api";
import { tariffLabel, useManagerOptions } from "../subscribers/subscriber-form";
import { SubscriberFilter } from "../subscribers/SubscriberFilter";
import { OBJECT_COLUMNS } from "./object-columns";
import { ObjectCreateDrawer } from "./ObjectCreateDrawer";
import { fetchObjectCount, fetchObjects, OBJECT_FILTER_KEYS, OBJECTS_KEY, type ObjectFilters } from "./objects.api";

const SEARCH_HINT = "Назва, IMEI, ICCID, номер SIM, клієнт";
const STATUS_OPTIONS = Object.entries(OBJECT_STATUS_META).map(([value, { label }]) => ({ value, label }));
const ARCHIVE_OPTIONS = [{ value: "true", label: "В архіві" }];

interface ListFiltersProps {
  filters: ObjectFilters;
  hasFilters: boolean;
  onChange: (key: keyof ObjectFilters, value: string | undefined) => void;
  onReset: () => void;
}

function ReferenceFilters({ filters, onChange }: Pick<ListFiltersProps, "filters" | "onChange">) {
  const programs = useReferenceOptions("programs", true);
  const servers = useReferenceOptions("servers", true);
  const tariffs = useReferenceOptions("tariffs", true);
  const models = useReferenceOptions("tracker-models", true);
  const addons = useReferenceOptions("addons", true);
  const tariffOptions = useMemo(
    () => (tariffs.items ?? []).map((tariff) => ({ value: tariff.id, label: tariffLabel(tariff) })),
    [tariffs.items],
  );
  return (
    <>
      <FilterSelect
        label="Програма"
        value={filters.programId}
        options={programs.options}
        isLoading={programs.isLoading}
        hasError={programs.hasError}
        onChange={(value) => onChange("programId", value)}
      />
      <FilterSelect
        label="Сервер"
        value={filters.serverId}
        options={servers.options}
        isLoading={servers.isLoading}
        hasError={servers.hasError}
        onChange={(value) => onChange("serverId", value)}
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
        label="Модель трекера"
        value={filters.modelId}
        options={models.options}
        isLoading={models.isLoading}
        hasError={models.hasError}
        onChange={(value) => onChange("modelId", value)}
      />
      <FilterSelect
        label="Послуга"
        value={filters.addonId}
        options={addons.options}
        isLoading={addons.isLoading}
        hasError={addons.hasError}
        onChange={(value) => onChange("addonId", value)}
      />
    </>
  );
}

function ListFilters({ filters, hasFilters, onChange, onReset }: ListFiltersProps) {
  const managers = useManagerOptions(true);
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
      <ReferenceFilters filters={filters} onChange={onChange} />
      <SubscriberFilter value={filters.subscriberId} onChange={(value) => onChange("subscriberId", value)} />
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
  return isCapped ? `Понад ${count} об'єктів` : `Об'єктів: ${count}`;
}

function ObjectsScreen() {
  const navigate = useNavigate();
  const canWrite = useCan("objects.write");
  const [isCreating, setCreating] = useState(false);
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(OBJECT_FILTER_KEYS);
  const { sort, applySort } = useUrlSort(OBJECT_SORTS);

  const pages = useInfiniteQuery({
    queryKey: [...OBJECTS_KEY, "list", filters, sort],
    queryFn: ({ pageParam, signal }) =>
      fetchObjects({ filters, sort: sort?.key, order: sort?.order, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  });
  const count = useQuery({
    queryKey: [...OBJECTS_KEY, "count", filters],
    queryFn: ({ signal }) => fetchObjectCount(filters, signal),
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => listRows(pages.data, pages.isPlaceholderData), [pages.data, pages.isPlaceholderData]);

  return (
    <>
      <ListPage
        title="Об'єкти"
        subtitle={count.data && countText(count.data.count, count.data.isCapped)}
        actions={
          canWrite && (
            <Button type="primary" onClick={() => setCreating(true)}>
              Новий об'єкт
            </Button>
          )
        }
        filters={<ListFilters filters={filters} hasFilters={hasFilters} onChange={setFilter} onReset={resetFilters} />}
        table={{
          rows,
          columns: OBJECT_COLUMNS,
          rowKey: "id",
          error: pages.error,
          empty: hasFilters ? <NothingFound onReset={resetFilters} /> : "Об'єктів ще немає",
          onRetry: () => void pages.refetch(),
          hasMore: pages.hasNextPage && !pages.isPlaceholderData,
          isLoadingMore: pages.isFetchingNextPage,
          onLoadMore: () => void pages.fetchNextPage(),
          sort,
          onSort: applySort,
          onRowClick: (row) => void navigate(`/objects/${row.id}`),
        }}
      />
      <ObjectCreateDrawer open={isCreating} onClose={() => setCreating(false)} />
    </>
  );
}

export function ObjectsPage() {
  const canRead = useCan("objects.read");
  return canRead ? <ObjectsScreen /> : <NoAccess />;
}
