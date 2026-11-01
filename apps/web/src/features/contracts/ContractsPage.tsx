import { CONTRACT_EXPIRY_DAYS, CONTRACT_STATUS_META, type Contract } from "@gps_crm/shared";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useNavigate } from "react-router";
import { listRows } from "../../lib/list-rows";
import { useCan } from "../../lib/session";
import { useUrlFilters } from "../../lib/url-filters";
import {
  DateFilter,
  DateText,
  EntityLink,
  FilterBar,
  FilterSelect,
  ListPage,
  NoAccess,
  NothingFound,
  SearchField,
  type DataTableColumn,
} from "../../ui";
import { SubscriberFilter } from "../subscribers/SubscriberFilter";
import { CONTRACT_FILTER_KEYS, CONTRACTS_KEY, fetchContracts } from "./contracts.api";
import { ContractFile, ContractStatus } from "./ContractParts";

const STATUS_OPTIONS = Object.entries(CONTRACT_STATUS_META).map(([value, { label }]) => ({ value, label }));
const EXPIRING_OPTIONS = [{ value: "true", label: `За ${CONTRACT_EXPIRY_DAYS} днів` }];

const COLUMNS: DataTableColumn<Contract>[] = [
  {
    title: "Номер",
    key: "number",
    render: (_, row) => <EntityLink to={`/subscribers/${row.subscriber.id}?tab=contracts`}>{row.number}</EntityLink>,
  },
  {
    title: "Клієнт",
    key: "subscriber",
    render: (_, row) => (
      <>
        {row.subscriber.name}
        <div className="table-note">ID {row.subscriber.code}</div>
      </>
    ),
  },
  {
    title: "Платник",
    key: "payer",
    render: (_, row) => (
      <>
        {row.payer.name}
        {row.payer.taxId && <div className="table-note">{row.payer.taxId}</div>}
      </>
    ),
  },
  { title: "Статус", key: "status", render: (_, row) => <ContractStatus contract={row} /> },
  { title: "Підписано", key: "signedOn", render: (_, row) => <DateText value={row.signedOn} /> },
  { title: "Діє до", key: "validUntil", render: (_, row) => <DateText value={row.validUntil} /> },
  { title: "Файл", key: "file", render: (_, row) => <ContractFile contract={row} /> },
];

function ContractsScreen() {
  const navigate = useNavigate();
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(CONTRACT_FILTER_KEYS);
  const pages = useInfiniteQuery({
    queryKey: [...CONTRACTS_KEY, "list", filters],
    queryFn: ({ pageParam, signal }) => fetchContracts(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => listRows(pages.data, pages.isPlaceholderData), [pages.data, pages.isPlaceholderData]);

  return (
    <ListPage
      title="Договори"
      subtitle="Договори всіх клієнтів"
      filters={
        <FilterBar hasFilters={hasFilters} onReset={resetFilters}>
          <SearchField
            label="Пошук"
            placeholder="Номер, клієнт, ID, платник, ЄДРПОУ"
            value={filters.q}
            onChange={(value) => setFilter("q", value)}
          />
          <FilterSelect
            label="Статус"
            value={filters.status}
            options={STATUS_OPTIONS}
            onChange={(value) => setFilter("status", value)}
          />
          <FilterSelect
            label="Спливають"
            value={filters.expiring}
            options={EXPIRING_OPTIONS}
            onChange={(value) => setFilter("expiring", value)}
          />
          <DateFilter
            label="Підписано від"
            value={filters.signedFrom}
            max={filters.signedTo}
            onChange={(value) => setFilter("signedFrom", value)}
          />
          <DateFilter
            label="Підписано до"
            value={filters.signedTo}
            min={filters.signedFrom}
            onChange={(value) => setFilter("signedTo", value)}
          />
          <SubscriberFilter value={filters.subscriberId} onChange={(value) => setFilter("subscriberId", value)} />
        </FilterBar>
      }
      table={{
        rows,
        columns: COLUMNS,
        rowKey: "id",
        error: pages.error,
        empty: hasFilters ? <NothingFound onReset={resetFilters} /> : "Договорів ще немає",
        onRetry: () => void pages.refetch(),
        hasMore: pages.hasNextPage && !pages.isPlaceholderData,
        isLoadingMore: pages.isFetchingNextPage,
        onLoadMore: () => void pages.fetchNextPage(),
        onRowClick: (row) => void navigate(`/subscribers/${row.subscriber.id}?tab=contracts`),
      }}
    />
  );
}

export function ContractsPage() {
  const canRead = useCan("subscribers.read");
  return canRead ? <ContractsScreen /> : <NoAccess />;
}
