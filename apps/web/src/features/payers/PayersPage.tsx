import { PAYER_CLIENTS_MAX, type Payer } from "@gps_crm/shared";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listRows } from "../../lib/list-rows";
import { useCan } from "../../lib/session";
import { useUrlFilters } from "../../lib/url-filters";
import {
  EmptyValue,
  EntityLink,
  FilterBar,
  ListPage,
  NoAccess,
  NothingFound,
  SearchField,
  type DataTableColumn,
} from "../../ui";
import { fetchPayerPage, PAYER_FILTER_KEYS, PAYERS_LIST_KEY } from "./payers.api";

const CLIENTS_SHOWN = 3;

function PayerClients({ clients }: { clients: Payer["otherClients"] }) {
  if (clients.length === 0) return <EmptyValue />;
  const rest = clients.length - CLIENTS_SHOWN;
  return (
    <>
      {clients.slice(0, CLIENTS_SHOWN).map((client) => (
        <div key={client.id}>
          <EntityLink to={`/subscribers/${client.id}?tab=payers`}>{client.name}</EntityLink>{" "}
          <span className="table-note">ID {client.code}</span>
        </div>
      ))}
      {rest > 0 && (
        <div className="table-note">
          і ще {rest}
          {clients.length === PAYER_CLIENTS_MAX && "+"}
        </div>
      )}
    </>
  );
}

const COLUMNS: DataTableColumn<Payer>[] = [
  {
    title: "Назва",
    key: "name",
    render: (_, row) => (
      <>
        {row.name}
        {row.legalName && <div className="table-note">{row.legalName}</div>}
      </>
    ),
  },
  { title: "ЄДРПОУ чи ІПН", key: "taxId", render: (_, row) => row.taxId ?? <EmptyValue /> },
  { title: "Клієнти", key: "clients", render: (_, row) => <PayerClients clients={row.otherClients} /> },
];

// D90: a plain list, newest first. A payer is made and changed in the card of a client, where its form lives.
function PayersScreen() {
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(PAYER_FILTER_KEYS);
  const pages = useInfiniteQuery({
    queryKey: [...PAYERS_LIST_KEY, filters],
    queryFn: ({ pageParam, signal }) => fetchPayerPage(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => listRows(pages.data, pages.isPlaceholderData), [pages.data, pages.isPlaceholderData]);

  return (
    <ListPage
      title="Платники"
      subtitle="Створюються й змінюються в картці клієнта, на вкладці «Платники»"
      filters={
        <FilterBar hasFilters={hasFilters} onReset={resetFilters}>
          <SearchField
            label="Пошук"
            placeholder="Назва, ЄДРПОУ чи ІПН"
            value={filters.q}
            onChange={(value) => setFilter("q", value)}
          />
        </FilterBar>
      }
      table={{
        rows,
        columns: COLUMNS,
        rowKey: "id",
        error: pages.error,
        empty: hasFilters ? <NothingFound onReset={resetFilters} q={filters.q} /> : "Платників ще немає",
        onRetry: () => void pages.refetch(),
        hasMore: pages.hasNextPage && !pages.isPlaceholderData,
        isLoadingMore: pages.isFetchingNextPage,
        onLoadMore: () => void pages.fetchNextPage(),
      }}
    />
  );
}

export function PayersPage() {
  const canRead = useCan("subscribers.read");
  return canRead ? <PayersScreen /> : <NoAccess />;
}
