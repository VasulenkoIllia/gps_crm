import { REFERENCE_STATUS, REFERENCE_STATUS_META, type ReferenceKind } from "@gps_crm/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { useMemo, useState } from "react";
import { useUrlFilters } from "../../lib/url-filters";
import {
  ConfirmAction,
  DataTable,
  errorMessage,
  FilterBar,
  FilterSelect,
  NothingFound,
  RowActions,
  StatusTag,
  type DataTableColumn,
  type RowAction,
} from "../../ui";
import { REFERENCE_TEXTS } from "./reference-texts";
import {
  deactivateReference,
  fetchReferencePage,
  refreshAfterChange,
  REFERENCES_KEY,
  type ReferenceItem,
} from "./references.api";

const STATUS_FILTER_KEYS = ["status"] as const;
const STATUS_OPTIONS = [
  { value: REFERENCE_STATUS.active, label: "Активні" },
  { value: REFERENCE_STATUS.inactive, label: "Деактивовані" },
];
const DEACTIVATION_CONSEQUENCE = "Запис зникне з вибору в нових формах і лишиться там, де вже обраний.";
const KNOWN_STATUSES: string[] = Object.values(REFERENCE_STATUS);

export interface TabProps {
  isAdding: boolean;
  canManage: boolean;
  onAdd: () => void;
  onAddClosed: () => void;
}

export interface RowFormProps<R> {
  row: R | null;
  open: boolean;
  onClose: () => void;
}

interface ReferenceTabProps<K extends ReferenceKind, A extends string> {
  kind: K;
  columns: DataTableColumn<ReferenceItem<K>>[];
  canManage: boolean;
  onAdd: () => void;
  // Actions of a row besides «Деактивувати», which this table does itself. A deactivated record is not edited: it is
  // brought back from the archive first, so `canEdit` is false for it.
  actionsFor: (row: ReferenceItem<K>, canEdit: boolean) => RowAction<A>[];
  onAction: (action: A, row: ReferenceItem<K>) => void;
}

function statusColumn<T extends { isActive: boolean }>(): DataTableColumn<T> {
  return {
    title: "Статус",
    key: "status",
    render: (_, row) => (
      <StatusTag status={row.isActive ? REFERENCE_STATUS_META.active : REFERENCE_STATUS_META.inactive} />
    ),
  };
}

export function ReferenceTab<K extends ReferenceKind, A extends string>(props: ReferenceTabProps<K, A>) {
  const { kind, columns, canManage, onAdd, actionsFor, onAction } = props;
  const texts = REFERENCE_TEXTS[kind];
  const client = useQueryClient();
  const { message } = App.useApp();
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(STATUS_FILTER_KEYS);
  const [deactivating, setDeactivating] = useState<ReferenceItem<K> | null>(null);
  // A value typed into the address by hand is no filter: the list stays whole rather than failing
  const status = KNOWN_STATUSES.includes(filters.status ?? "") ? filters.status : undefined;

  const list = useInfiniteQuery({
    queryKey: [...REFERENCES_KEY, kind, { status }],
    queryFn: ({ pageParam, signal }) => fetchReferencePage(kind, { status, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const rows = useMemo(() => list.data?.pages.flatMap((page) => page.items), [list.data]);

  const deactivate = useMutation({
    mutationFn: (row: ReferenceItem<K>) => deactivateReference(kind, row.id),
    onSuccess: () => {
      refreshAfterChange(client);
      setDeactivating(null);
      void message.success("Запис деактивовано. Повернути його можна з архіву");
    },
    onError: (error) => {
      refreshAfterChange(client);
      setDeactivating(null);
      void message.error(errorMessage(error));
    },
  });

  const shownColumns = useMemo((): DataTableColumn<ReferenceItem<K>>[] => {
    const actionsColumn: DataTableColumn<ReferenceItem<K>> = {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, row) => {
        const canEdit = canManage && row.isActive;
        const closing = canEdit ? [{ key: "deactivate", label: "Деактивувати" } as const] : [];
        return (
          <RowActions<A | "deactivate">
            rowName={row.name}
            actions={[...actionsFor(row, canEdit), ...closing]}
            onAction={(action) => {
              if (action === "deactivate") setDeactivating(row);
              else onAction(action, row);
            }}
          />
        );
      },
    };
    return [...columns, statusColumn(), actionsColumn];
  }, [columns, canManage, actionsFor, onAction]);

  return (
    <>
      <FilterBar hasFilters={hasFilters} onReset={resetFilters}>
        <FilterSelect
          label="Статус"
          value={status}
          options={STATUS_OPTIONS}
          onChange={(value) => setFilter("status", value)}
        />
      </FilterBar>
      <DataTable
        rows={rows}
        columns={shownColumns}
        rowKey="id"
        error={list.error}
        empty={
          hasFilters ? (
            <NothingFound onReset={resetFilters} />
          ) : (
            <>
              <p>{texts.empty}</p>
              {canManage && <Button onClick={onAdd}>{texts.add}</Button>}
            </>
          )
        }
        onRetry={() => void list.refetch()}
        hasMore={list.hasNextPage}
        isLoadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
      />
      <ConfirmAction
        title={`Деактивувати: ${deactivating?.name ?? ""}?`}
        consequence={[DEACTIVATION_CONSEQUENCE, texts.cascadeNote].filter(Boolean).join(" ")}
        actionLabel="Деактивувати"
        open={deactivating !== null}
        isPending={deactivate.isPending}
        onConfirm={() => deactivating && deactivate.mutate(deactivating)}
        onClose={() => setDeactivating(null)}
      />
    </>
  );
}
