import type { EquipmentPlace } from "@gps_crm/shared";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { listRows } from "../../lib/list-rows";
import { useCan } from "../../lib/session";
import { RowActions, type DataTableColumn } from "../../ui";
import { useConfirmedAction, type PlannedAction } from "../subscribers/useConfirmedAction";
import { deleteEquipment, EQUIPMENT_KEY, equipmentAction, type EquipmentPath } from "./equipment.api";

type RecordAction = "archive" | "restore" | "delete";
type RowAction = "edit" | RecordAction;

interface EquipmentRecord {
  id: string;
  isArchived: boolean;
  place: EquipmentPlace | null;
}

interface Rights {
  canWrite: boolean;
  canArchive: boolean;
  canDelete: boolean;
}

// Whatever stands on an object leaves it first: П4, and the server refuses all the same
function actionsOf({ isArchived, place }: EquipmentRecord, rights: Rights) {
  const all: { key: RowAction; label: string; isOn: boolean }[] = [
    { key: "edit", label: "Змінити", isOn: rights.canWrite && !isArchived },
    { key: "archive", label: "Архівувати", isOn: rights.canArchive && !isArchived && !place },
    { key: "restore", label: "Відновити", isOn: rights.canArchive && isArchived },
    { key: "delete", label: "Видалити", isOn: rights.canDelete && !isArchived && !place },
  ];
  return all.filter(({ isOn }) => isOn);
}

function planFor(path: EquipmentPath, id: string, name: string, key: RecordAction): PlannedAction {
  const plans: Record<RecordAction, PlannedAction> = {
    archive: {
      title: `Архівувати: ${name}?`,
      consequence: "Запис зникне зі списків. Повернути його можна з архіву.",
      actionLabel: "Архівувати",
      doneText: "Запис в архіві",
      run: () => equipmentAction(path, id, "archive"),
    },
    restore: {
      title: `Відновити: ${name}?`,
      consequence: "Запис повернеться до вільних.",
      actionLabel: "Відновити",
      doneText: "Запис відновлено",
      run: () => equipmentAction(path, id, "restore"),
    },
    delete: {
      title: `Видалити: ${name}?`,
      consequence: "Запис буде видалено назавжди. Те, що вже десь стояло, видалити не можна, лише архівувати.",
      actionLabel: "Видалити",
      doneText: "Запис видалено",
      isDanger: true,
      run: () => deleteEquipment(path, id),
    },
  };
  return plans[key];
}

interface EquipmentPage<T> {
  items: T[];
  nextCursor: string | null;
}

interface EquipmentRowsOptions<T> {
  path: EquipmentPath;
  filters: object;
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<EquipmentPage<T>>;
  nameOf: (row: T) => string;
  onEdit: (row: T) => void;
}

// The three tabs differ in columns and filters. What a list does and what a row can do is one thing.
export function useEquipmentRows<T extends EquipmentRecord>(options: EquipmentRowsOptions<T>) {
  const { path, filters, fetchPage, nameOf, onEdit } = options;
  const canWrite = useCan("equipment.write");
  const canArchive = useCan("records.archive");
  const canDelete = useCan("records.delete");
  const confirm = useConfirmedAction();
  const ask = confirm.ask;
  const pages = useInfiniteQuery({
    queryKey: [...EQUIPMENT_KEY, path, filters],
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => listRows(pages.data, pages.isPlaceholderData), [pages.data, pages.isPlaceholderData]);
  const actionsColumn = useMemo((): DataTableColumn<T> => {
    const rights = { canWrite, canArchive, canDelete };
    return {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, row) => (
        <RowActions
          rowName={nameOf(row)}
          actions={actionsOf(row, rights)}
          onAction={(key) => (key === "edit" ? onEdit(row) : ask(planFor(path, row.id, nameOf(row), key)))}
        />
      ),
    };
  }, [path, nameOf, onEdit, ask, canWrite, canArchive, canDelete]);

  return {
    table: {
      rows,
      rowKey: "id" as const,
      error: pages.error,
      onRetry: () => void pages.refetch(),
      hasMore: pages.hasNextPage && !pages.isPlaceholderData,
      isLoadingMore: pages.isFetchingNextPage,
      onLoadMore: () => void pages.fetchNextPage(),
    },
    actionsColumn,
    dialog: confirm.dialog,
  };
}
