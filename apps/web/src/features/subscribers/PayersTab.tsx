import { ARCHIVED_STATUS_META, PAYMENT_METHODS, type Payer, type SubscriberCard } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Skeleton } from "antd";
import { useState } from "react";
import { useCan } from "../../lib/session";
import { EmptyValue, EntityLink, FactList, LoadError, RowActions, StatusTag, type Fact } from "../../ui";
import { PayerForm, PayerLinkModal } from "./PayerForm";
import { fetchPayers, payerAction, payersKey, unlinkPayer } from "./subscribers.api";
import { useConfirmedAction, type PlannedAction } from "./useConfirmedAction";

type PayerActionKey = "edit" | "unlink" | "archive" | "restore";

interface PayerRights {
  canWrite: boolean;
  canArchive: boolean;
}

function actionsOf(payer: Payer, { canWrite, canArchive }: PayerRights) {
  const isLive = !payer.isArchived;
  const all: { key: PayerActionKey; label: string; isOn: boolean }[] = [
    { key: "edit", label: "Змінити", isOn: canWrite && isLive },
    { key: "unlink", label: "Відв'язати", isOn: canWrite },
    { key: "archive", label: "Архівувати", isOn: canArchive && isLive },
    { key: "restore", label: "Відновити", isOn: canArchive && !isLive },
  ];
  return all.filter(({ isOn }) => isOn);
}

function planFor(payer: Payer, subscriberId: string, key: Exclude<PayerActionKey, "edit">): PlannedAction {
  const { id, name } = payer;
  const plans: Record<typeof key, PlannedAction> = {
    unlink: {
      title: `Відв'язати: ${name}?`,
      consequence: "Платник лишиться в системі, але не в цьому клієнті.",
      actionLabel: "Відв'язати",
      doneText: "Платника відв'язано",
      run: () => unlinkPayer(subscriberId, id),
    },
    archive: {
      title: `Архівувати: ${name}?`,
      consequence: "Платник зникне з роботи в усіх його клієнтів, повернути його можна з архіву.",
      actionLabel: "Архівувати",
      doneText: "Платник в архіві",
      run: () => payerAction(id, "archive"),
    },
    restore: {
      title: `Відновити: ${name}?`,
      consequence: "Платник повернеться до роботи.",
      actionLabel: "Відновити",
      doneText: "Платника відновлено",
      run: () => payerAction(id, "restore"),
    },
  };
  return plans[key];
}

function factsOf(payer: Payer): Fact[] {
  const others = payer.otherClients;
  return [
    { label: "Форма оплати", value: PAYMENT_METHODS[payer.paymentMethod] },
    { label: "ЄДРПОУ / ІПН", value: payer.taxId ?? <EmptyValue /> },
    { label: "Контакт для реквізитів", value: payer.detailsContact ?? <EmptyValue /> },
    {
      label: "Інші клієнти",
      value:
        others.length > 0 ? (
          others.map((client, index) => (
            <span key={client.id}>
              {index > 0 && ", "}
              <EntityLink to={`/subscribers/${client.id}`}>{client.name}</EntityLink>
            </span>
          ))
        ) : (
          <EmptyValue />
        ),
    },
    { label: "Об'єктів", value: payer.objectCount },
    { label: "Договір", value: payer.contractNumbers.join(", ") || <EmptyValue /> },
    { label: "Умови оплати", value: payer.paymentTermsNote ?? <EmptyValue /> },
  ];
}

interface PayerCardProps {
  payer: Payer;
  rights: PayerRights;
  onAction: (key: PayerActionKey) => void;
}

function PayerCard({ payer, rights, onAction }: PayerCardProps) {
  return (
    <article className="record-card">
      <header className="record-card-head">
        <h3 className="record-card-title">{payer.name}</h3>
        {payer.isArchived && <StatusTag status={ARCHIVED_STATUS_META} />}
        <RowActions rowName={payer.name} actions={actionsOf(payer, rights)} onAction={onAction} />
      </header>
      <FactList items={factsOf(payer)} />
    </article>
  );
}

export function PayersTab({ card }: { card: SubscriberCard }) {
  const canWriteAny = useCan("subscribers.write");
  const canArchive = useCan("records.archive");
  const canWrite = canWriteAny && !card.isArchived;
  const [editing, setEditing] = useState<Payer | "new" | null>(null);
  const [isLinking, setLinking] = useState(false);
  const confirm = useConfirmedAction();
  const payers = useQuery({ queryKey: payersKey(card.id), queryFn: ({ signal }) => fetchPayers(card.id, signal) });
  const rows = payers.data?.items;

  function act(payer: Payer, key: PayerActionKey) {
    if (key === "edit") setEditing(payer);
    else confirm.ask(planFor(payer, card.id, key));
  }

  if (!rows)
    return payers.error ? (
      <LoadError error={payers.error} onRetry={() => void payers.refetch()} />
    ) : (
      <Skeleton active />
    );

  return (
    <>
      {canWrite && (
        <div className="tab-actions">
          <Button onClick={() => setEditing("new")}>Додати платника</Button>
          <Button onClick={() => setLinking(true)}>Прив'язати наявного</Button>
        </div>
      )}
      {rows.length === 0 && <Empty description="Платників ще немає" />}
      <div className="record-cards">
        {rows.map((payer) => (
          <PayerCard
            key={payer.id}
            payer={payer}
            rights={{ canWrite, canArchive }}
            onAction={(key) => act(payer, key)}
          />
        ))}
      </div>
      <PayerForm
        key={editing === "new" ? "new" : editing?.id}
        subscriberId={card.id}
        row={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <PayerLinkModal subscriberId={card.id} open={isLinking} onClose={() => setLinking(false)} />
      {confirm.dialog}
    </>
  );
}
