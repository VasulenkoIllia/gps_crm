import type { ReactNode } from "react";
import { DataTable, type DataTableProps } from "./DataTable";
import { PageHeader } from "./PageHeader";
import { Panel } from "./Panel";

interface ListPageProps<T> {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  filters: ReactNode;
  table: DataTableProps<T>;
}

// The shape of every list of the system: 05-ui-standard.md §5.2
export function ListPage<T extends object>({ title, subtitle, actions, filters, table }: ListPageProps<T>) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <Panel>
        {filters}
        <DataTable {...table} />
      </Panel>
    </>
  );
}
