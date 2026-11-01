import type { Contract, SubscriberCard } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { useCan } from "../../lib/session";
import { DataTable, DateText, RowActions, type DataTableColumn } from "../../ui";
import { clientContractsKey, contractAction, fetchClientContracts } from "../contracts/contracts.api";
import { ContractForm } from "../contracts/ContractForm";
import { ContractFile, ContractStatus } from "../contracts/ContractParts";
import { useConfirmedAction, type PlannedAction } from "./useConfirmedAction";

type ContractActionKey = "edit" | "archive" | "restore";

interface ContractRights {
  canWrite: boolean;
  canArchive: boolean;
}

function actionsOf(contract: Contract, { canWrite, canArchive }: ContractRights) {
  const isLive = !contract.isArchived;
  const all: { key: ContractActionKey; label: string; isOn: boolean }[] = [
    { key: "edit", label: "Змінити", isOn: canWrite && isLive },
    { key: "archive", label: "Архівувати", isOn: canArchive && isLive },
    { key: "restore", label: "Відновити", isOn: canArchive && !isLive },
  ];
  return all.filter(({ isOn }) => isOn);
}

function planFor({ id, number }: Contract, key: Exclude<ContractActionKey, "edit">): PlannedAction {
  return key === "archive"
    ? {
        title: `Архівувати договір ${number}?`,
        consequence: "Договір зникне зі списків, повернути його можна з архіву.",
        actionLabel: "Архівувати",
        doneText: "Договір в архіві",
        run: () => contractAction(id, "archive"),
      }
    : {
        title: `Відновити договір ${number}?`,
        consequence: "Договір повернеться до роботи.",
        actionLabel: "Відновити",
        doneText: "Договір відновлено",
        run: () => contractAction(id, "restore"),
      };
}

function buildColumns(rights: ContractRights, onAction: (row: Contract, key: ContractActionKey) => void) {
  const columns: DataTableColumn<Contract>[] = [
    { title: "Номер", dataIndex: "number" },
    { title: "Платник", key: "payer", render: (_, row) => row.payer.name },
    { title: "Статус", key: "status", render: (_, row) => <ContractStatus contract={row} /> },
    { title: "Підписано", key: "signedOn", render: (_, row) => <DateText value={row.signedOn} /> },
    { title: "Діє до", key: "validUntil", render: (_, row) => <DateText value={row.validUntil} /> },
    { title: "Файл", key: "file", render: (_, row) => <ContractFile contract={row} /> },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, row) => (
        <RowActions
          rowName={`Договір ${row.number}`}
          actions={actionsOf(row, rights)}
          onAction={(key) => onAction(row, key)}
        />
      ),
    },
  ];
  return columns;
}

export function ContractsTab({ card }: { card: SubscriberCard }) {
  const canWriteAny = useCan("subscribers.write");
  const canArchive = useCan("records.archive");
  const canWrite = canWriteAny && !card.isArchived;
  const [editing, setEditing] = useState<Contract | "new" | null>(null);
  const confirm = useConfirmedAction();
  const contracts = useQuery({
    queryKey: clientContractsKey(card.id),
    queryFn: ({ signal }) => fetchClientContracts(card.id, signal),
  });
  const ask = confirm.ask;
  const columns = useMemo(
    () =>
      buildColumns({ canWrite, canArchive }, (row, key) => (key === "edit" ? setEditing(row) : ask(planFor(row, key)))),
    [canWrite, canArchive, ask],
  );

  return (
    <>
      {canWrite && (
        <div className="tab-actions">
          <Button onClick={() => setEditing("new")}>Додати договір</Button>
        </div>
      )}
      <DataTable
        rows={contracts.data?.items}
        columns={columns}
        rowKey="id"
        error={contracts.error}
        empty="Договорів ще немає"
        onRetry={() => void contracts.refetch()}
      />
      <ContractForm
        key={editing === "new" ? "new" : editing?.id}
        subscriberId={card.id}
        row={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      {confirm.dialog}
    </>
  );
}
