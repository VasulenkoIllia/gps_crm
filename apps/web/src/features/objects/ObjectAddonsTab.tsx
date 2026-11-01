import type { ObjectCard } from "@gps_crm/shared";
import { Button } from "antd";
import { useMemo } from "react";
import { DataTable, DateText, RowActions, type DataTableColumn } from "../../ui";

type Addon = ObjectCard["addons"][number];

function columnsOf(canChange: boolean, onDisconnect: (addon: Addon) => void): DataTableColumn<Addon>[] {
  return [
    { title: "Послуга", dataIndex: "addonName" },
    { title: "Діє з", key: "validFrom", render: (_, row) => <DateText value={row.validFrom} /> },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, row) => (
        <RowActions
          rowName={row.addonName}
          actions={canChange ? [{ key: "disconnect", label: "Відключити" }] : []}
          onAction={() => onDisconnect(row)}
        />
      ),
    },
  ];
}

interface ObjectAddonsTabProps {
  card: ObjectCard;
  canChange: boolean;
  onConnect: () => void;
  onDisconnect: (addon: Addon) => void;
}

export function ObjectAddonsTab({ card, canChange, onConnect, onDisconnect }: ObjectAddonsTabProps) {
  const columns = useMemo(() => columnsOf(canChange, onDisconnect), [canChange, onDisconnect]);
  return (
    <>
      {canChange && (
        <div className="tab-actions">
          <Button onClick={onConnect}>Підключити послугу</Button>
        </div>
      )}
      <DataTable
        rows={card.addons}
        columns={columns}
        rowKey="addonId"
        error={null}
        empty="Послуг немає"
        onRetry={() => undefined}
      />
    </>
  );
}
