import { SUBSCRIBER_TYPES, type IdSeries } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { useCan } from "../../lib/session";
import { DataTable, EmptyValue, NoAccess, PageHeader, Panel, RowActions, type DataTableColumn } from "../../ui";
import { useConfirmedAction } from "../subscribers/useConfirmedAction";
import { deleteIdSeries, fetchIdSeries, ID_SERIES_KEY } from "./id-series.api";
import { IdSeriesForm } from "./IdSeriesForm";

const EXPLANATION =
  "Серія задає, з якого діапазону система бере ID для нових клієнтів обраних типів. " +
  "Наявні ID зміна серії не змінює. ID можна змінити вручну в картці клієнта.";
const ACTIONS = [
  { key: "edit", label: "Змінити" },
  { key: "delete", label: "Видалити" },
];

function buildColumns(canManage: boolean, onAction: (row: IdSeries, key: string) => void) {
  const columns: DataTableColumn<IdSeries>[] = [
    { title: "Назва", dataIndex: "name" },
    {
      title: "Типи клієнтів",
      key: "types",
      render: (_, row) => row.types.map((type) => SUBSCRIBER_TYPES[type]).join(", ") || <EmptyValue />,
    },
    { title: "Від", dataIndex: "rangeFrom", align: "right" },
    { title: "До", dataIndex: "rangeTo", align: "right" },
    { title: "Наступний", dataIndex: "nextNumber", align: "right" },
    { title: "Лишилось", dataIndex: "numbersLeft", align: "right" },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      hidden: !canManage,
      render: (_, row) => <RowActions rowName={row.name} actions={ACTIONS} onAction={(key) => onAction(row, key)} />,
    },
  ];
  return columns;
}

function IdSeriesScreen() {
  const canManage = useCan("references.manage");
  const [editing, setEditing] = useState<IdSeries | "new" | null>(null);
  const confirm = useConfirmedAction();
  const series = useQuery({ queryKey: ID_SERIES_KEY, queryFn: ({ signal }) => fetchIdSeries(signal) });
  const ask = confirm.ask;
  const columns = useMemo(
    () =>
      buildColumns(canManage, (row, key) => {
        if (key === "edit") {
          setEditing(row);
          return;
        }
        ask({
          title: `Видалити серію «${row.name}»?`,
          consequence: "Видані ID лишаться. Серію з типами клієнтів видалити не можна.",
          actionLabel: "Видалити",
          doneText: "Серію видалено",
          isDanger: true,
          run: () => deleteIdSeries(row.id),
        });
      }),
    [canManage, ask],
  );

  return (
    <>
      <PageHeader
        title="Серії ID"
        actions={
          canManage && (
            <Button type="primary" onClick={() => setEditing("new")}>
              Нова серія
            </Button>
          )
        }
      />
      <Panel>
        <p className="form-note">{EXPLANATION}</p>
        <DataTable
          rows={series.data?.items}
          columns={columns}
          rowKey="id"
          error={series.error}
          empty="Серій ще немає"
          onRetry={() => void series.refetch()}
        />
      </Panel>
      <IdSeriesForm
        key={editing === "new" ? "new" : editing?.id}
        row={editing === "new" ? null : editing}
        all={series.data?.items ?? []}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      {confirm.dialog}
    </>
  );
}

export function IdSeriesPage() {
  const canRead = useCan("subscribers.read");
  return canRead ? <IdSeriesScreen /> : <NoAccess />;
}
