import { Button, Empty, Grid, Skeleton, Table, type TableColumnType } from "antd";
import { useMemo, type ReactNode } from "react";
import { FormAlert } from "./FormAlert";
import { LoadError } from "./LoadError";

export type DataTableColumn<T> = TableColumnType<T>;

export interface TableSort {
  key: string;
  order: "asc" | "desc";
}

export interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: DataTableColumn<T>[];
  rowKey: keyof T & string;
  error: unknown;
  empty: ReactNode;
  onRetry: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  // The server sorts: a column offers it with `sorter: true` and a `key`, and this says which one is on
  sort?: TableSort;
  onSort?: (sort: TableSort | null) => void;
  onRowClick?: (row: T) => void;
}

const SORT_ORDERS = { asc: "ascend", desc: "descend" } as const;
const PINNED_COLUMN_WIDTH_PX = 160;
// On the cell too: under a max-content table a column's width is only a wish, and a long name would take the whole
// screen and leave nothing to scroll. It wraps rather than cuts, because a phone has no pointer to show the rest.
const PINNED_CELL = { style: { maxWidth: PINNED_COLUMN_WIDTH_PX, overflowWrap: "anywhere" } } as const;

// On a phone the table scrolls sideways under a pinned first column: 05-ui-standard.md §5.8
function pinFirst<T>(columns: DataTableColumn<T>[]): DataTableColumn<T>[] {
  return columns.map((column, index) =>
    index === 0 ? { ...column, fixed: "left", width: PINNED_COLUMN_WIDTH_PX, onCell: () => PINNED_CELL } : column,
  );
}

function withSortOrder<T>(columns: DataTableColumn<T>[], sort: TableSort | undefined): DataTableColumn<T>[] {
  return columns.map((column) => {
    if (!column.sorter) return column;
    const sortOrder = sort && column.key === sort.key ? SORT_ORDERS[sort.order] : null;
    return { ...column, sortOrder, sortDirections: ["ascend", "descend"] };
  });
}

// A press on a link or a button in a row is about that link or button, and text selected to copy is not a press at all
function isPlainRowClick(target: EventTarget): boolean {
  const isSelecting = window.getSelection()?.isCollapsed === false;
  return !isSelecting && !(target as HTMLElement).closest("a, button");
}

export function DataTable<T extends object>(props: DataTableProps<T>) {
  const { rows, columns, rowKey, error, empty, onRetry, hasMore, isLoadingMore, onLoadMore } = props;
  const { sort, onSort, onRowClick } = props;
  const isPhone = Grid.useBreakpoint().md === false;
  const shown = useMemo(() => {
    const sorted = withSortOrder(columns, sort);
    return isPhone ? pinFirst(sorted) : sorted;
  }, [isPhone, columns, sort]);

  if (!rows) return error ? <LoadError error={error} onRetry={onRetry} /> : <Skeleton active />;

  return (
    <>
      {/* The rows stay: a page or a refresh that failed takes nothing away from what is already here. It stands above
          an empty list too, which would otherwise pass for a fresh reading */}
      <FormAlert error={error} />
      {rows.length === 0 && <Empty description={empty} />}
      {rows.length > 0 && (
        <Table<T>
          dataSource={rows}
          columns={shown}
          rowKey={rowKey}
          pagination={false}
          scroll={{ x: "max-content" }}
          rowClassName={onRowClick ? "table-row-link" : undefined}
          onRow={(row) => ({
            onClick: (event) => {
              if (onRowClick && isPlainRowClick(event.target)) onRowClick(row);
            },
          })}
          onChange={(_pagination, _filters, sorter) => {
            const { columnKey, order } = [sorter].flat()[0] ?? {};
            onSort?.(order ? { key: String(columnKey), order: order === "ascend" ? "asc" : "desc" } : null);
          }}
        />
      )}
      {hasMore && (
        <div className="table-footer">
          <Button loading={isLoadingMore} onClick={onLoadMore}>
            Показати ще
          </Button>
        </div>
      )}
    </>
  );
}
