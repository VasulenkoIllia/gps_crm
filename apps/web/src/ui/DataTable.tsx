import { Button, Empty, Grid, Skeleton, Table, type TableColumnType } from "antd";
import { useMemo, type ReactNode } from "react";
import { FormAlert } from "./FormAlert";
import { LoadError } from "./LoadError";

export type DataTableColumn<T> = TableColumnType<T>;

interface DataTableProps<T> {
  rows: T[] | undefined;
  columns: DataTableColumn<T>[];
  rowKey: keyof T & string;
  error: unknown;
  empty: ReactNode;
  onRetry: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

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

export function DataTable<T extends object>(props: DataTableProps<T>) {
  const { rows, columns, rowKey, error, empty, onRetry, hasMore, isLoadingMore, onLoadMore } = props;
  const isPhone = Grid.useBreakpoint().md === false;
  const shown = useMemo(() => (isPhone ? pinFirst(columns) : columns), [isPhone, columns]);

  if (!rows) return error ? <LoadError error={error} onRetry={onRetry} /> : <Skeleton active />;
  if (rows.length === 0) return <Empty description={empty} />;

  return (
    <>
      {/* The rows stay: a page or a refresh that failed takes nothing away from what is already here */}
      <FormAlert error={error} />
      <Table<T> dataSource={rows} columns={shown} rowKey={rowKey} pagination={false} scroll={{ x: "max-content" }} />
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
