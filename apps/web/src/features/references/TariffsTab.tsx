import { BILLING_MODELS, type BillingModel, type Tariff } from "@gps_crm/shared";
import { useCallback, useState } from "react";
import { Money, type DataTableColumn, type RowAction } from "../../ui";
import { ReferenceTab, type TabProps } from "./ReferenceTab";
import { TariffForm, TariffVersionModal } from "./TariffForms";

type TariffAction = "edit" | "version";

// The number of clients on a tariff joins these columns with the clients themselves on step 4 (D55)
const COLUMNS: DataTableColumn<Tariff>[] = [
  { title: "Програма", dataIndex: "programName" },
  { title: "Сервер", dataIndex: "serverName" },
  { title: "Назва", dataIndex: "name" },
  { title: "Період", dataIndex: "billingModel", render: (value: BillingModel) => BILLING_MODELS[value] },
  { title: "Ціна", dataIndex: "priceKop", align: "right", render: (kop: number) => <Money kop={kop} /> },
];

export function TariffsTab({ isAdding, canManage, onAdd, onAddClosed }: TabProps) {
  const [editing, setEditing] = useState<Tariff | null>(null);
  const [versionOf, setVersionOf] = useState<Tariff | null>(null);

  const actionsFor = useCallback(
    (_: Tariff, canEdit: boolean): RowAction<TariffAction>[] =>
      canEdit
        ? [
            { key: "edit", label: "Змінити" },
            { key: "version", label: "Нова версія тарифу" },
          ]
        : [],
    [],
  );
  const onAction = useCallback((action: TariffAction, row: Tariff) => {
    if (action === "edit") setEditing(row);
    else setVersionOf(row);
  }, []);

  return (
    <>
      <ReferenceTab<"tariffs", TariffAction>
        kind="tariffs"
        columns={COLUMNS}
        canManage={canManage}
        onAdd={onAdd}
        actionsFor={actionsFor}
        onAction={onAction}
      />
      <TariffForm
        row={editing}
        open={isAdding || editing !== null}
        onClose={() => {
          setEditing(null);
          onAddClosed();
        }}
      />
      <TariffVersionModal source={versionOf} onClose={() => setVersionOf(null)} />
    </>
  );
}
