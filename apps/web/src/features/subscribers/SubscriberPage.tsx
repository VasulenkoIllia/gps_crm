import {
  ARCHIVED_STATUS_META,
  BILLING_MODELS,
  paymentFormat,
  SUBSCRIBER_STATUS_META,
  SUBSCRIBER_TYPES,
  type SubscriberCard,
} from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Empty, Skeleton } from "antd";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useCan } from "../../lib/session";
import {
  DateText,
  DetailPage,
  EmptyValue,
  ExternalLink,
  FactList,
  LoadError,
  Money,
  NoAccess,
  RowActions,
  StatusTag,
  type DetailTab,
  type Fact,
} from "../../ui";
import { ClientActivityTab } from "./ClientActivityTab";
import { ContactsTab } from "./ContactsTab";
import { ContractsTab } from "./ContractsTab";
import { PayersTab } from "./PayersTab";
import { CodeChangeModal, SubscriberEditDrawer, TariffChangeModal } from "./SubscriberForms";
import {
  archiveSubscriber,
  deleteSubscriber,
  fetchSubscriber,
  restoreSubscriber,
  subscriberKey,
} from "./subscribers.api";
import { useConfirmedAction, type PlannedAction } from "./useConfirmedAction";

type CardForm = "edit" | "tariff" | "code";
type RecordAction = "archive" | "restore" | "delete";

function factsOf(card: SubscriberCard): Fact[] {
  const [tariff] = card.tariffHistory;
  return [
    { label: "ID", value: card.code },
    { label: "Старий номер", value: card.legacyCode ?? <EmptyValue /> },
    { label: "Тип", value: SUBSCRIBER_TYPES[card.type] },
    { label: "ЄДРПОУ / ІПН", value: card.taxId ?? <EmptyValue /> },
    { label: "Менеджер", value: card.managerName },
    { label: "Посилання на CRM", value: <ExternalLink href={card.crmUrl}>Відкрити</ExternalLink> },
    { label: "Програма", value: card.programName },
    {
      label: "Тариф",
      value:
        tariff && `${tariff.tariffName}, ${tariff.serverName}, ${BILLING_MODELS[tariff.billingModel].toLowerCase()}`,
    },
    { label: "Ціна за тарифом", value: <Money kop={tariff?.priceKop} /> },
    { label: "Діє з", value: <DateText value={tariff?.validFrom} /> },
    { label: "Формат оплати", value: paymentFormat(card.graceDays) },
    { label: "Знижка", value: <Money kop={card.discountKop} /> },
    { label: "Договір діє до", value: <DateText value={card.contractValidUntil} /> },
    {
      label: "Об'єкти",
      value: `активні: ${card.objectsActive}, призупинені: ${card.objectsSuspended}, відключені: ${card.objectsDisconnected}`,
    },
    { label: "Примітка", value: card.note ?? <EmptyValue /> },
  ];
}

function planFor({ id, name }: SubscriberCard, key: RecordAction, onDeleted: () => void): PlannedAction {
  const plans: Record<RecordAction, PlannedAction> = {
    archive: {
      title: `Архівувати: ${name}?`,
      consequence: "Клієнт зникне зі списків разом з контактами й договорами. Повернути його можна з архіву.",
      actionLabel: "Архівувати",
      doneText: "Клієнт в архіві",
      run: () => archiveSubscriber(id),
    },
    restore: {
      title: `Відновити: ${name}?`,
      consequence: "Клієнт повернеться до роботи разом з усім, що було заархівовано з ним.",
      actionLabel: "Відновити",
      doneText: "Клієнта відновлено",
      run: () => restoreSubscriber(id),
    },
    delete: {
      title: `Видалити: ${name}?`,
      consequence: "Запис буде видалено назавжди, а його ID стане вільним.",
      actionLabel: "Видалити",
      doneText: "Клієнта видалено",
      isDanger: true,
      run: () => deleteSubscriber(id),
      onDone: onDeleted,
    },
  };
  return plans[key];
}

function useRecordActions(card: SubscriberCard) {
  const canArchive = useCan("records.archive");
  const canDelete = useCan("records.delete");
  const all: { key: RecordAction; label: string; isOn: boolean }[] = [
    { key: "archive", label: "Архівувати", isOn: canArchive && !card.isArchived },
    { key: "restore", label: "Відновити", isOn: canArchive && card.isArchived },
    { key: "delete", label: "Видалити", isOn: canDelete },
  ];
  return all.filter(({ isOn }) => isOn);
}

function SubscriberView({ card }: { card: SubscriberCard }) {
  const navigate = useNavigate();
  const canWrite = useCan("subscribers.write") && !card.isArchived;
  const canChangeCode = useCan("subscribers.code.change") && !card.isArchived;
  const canReadActivity = useCan("activity.read");
  const recordActions = useRecordActions(card);
  // The card as the form was opened on it: a refetch must not move the version under what the person is reading
  const [opened, setOpened] = useState<{ form: CardForm; card: SubscriberCard } | null>(null);
  const confirm = useConfirmedAction();
  const openForm = (form: CardForm) => setOpened({ form, card });
  const closeForm = () => setOpened(null);
  const formCard = opened?.card ?? card;

  const tabs: DetailTab[] = [
    { key: "objects", label: "Об'єкти", render: () => <Empty description="Об'єктів ще немає" /> },
    { key: "contacts", label: "Контакти", render: () => <ContactsTab card={card} /> },
    { key: "payers", label: "Платники", render: () => <PayersTab card={card} /> },
    { key: "contracts", label: "Договори", render: () => <ContractsTab card={card} /> },
    ...(canReadActivity
      ? [{ key: "activity", label: "Журнал змін", render: () => <ClientActivityTab subscriberId={card.id} /> }]
      : []),
  ];

  return (
    <>
      <DetailPage
        title={card.name}
        subtitle={
          <div className="detail-subtitle">
            <StatusTag status={card.isArchived ? ARCHIVED_STATUS_META : SUBSCRIBER_STATUS_META[card.status]} />
          </div>
        }
        actions={
          <div className="detail-actions">
            {canWrite && <Button onClick={() => openForm("edit")}>Змінити</Button>}
            {canWrite && <Button onClick={() => openForm("tariff")}>Змінити тариф</Button>}
            {canChangeCode && <Button onClick={() => openForm("code")}>Змінити ID</Button>}
            <RowActions
              rowName={card.name}
              actions={recordActions}
              onAction={(key) => confirm.ask(planFor(card, key, () => void navigate("/subscribers")))}
            />
          </div>
        }
        facts={<FactList items={factsOf(card)} />}
        tabs={tabs}
      />
      <SubscriberEditDrawer card={formCard} open={opened?.form === "edit"} onClose={closeForm} />
      <TariffChangeModal card={formCard} open={opened?.form === "tariff"} onClose={closeForm} />
      <CodeChangeModal card={formCard} open={opened?.form === "code"} onClose={closeForm} />
      {confirm.dialog}
    </>
  );
}

function SubscriberScreen({ id }: { id: string }) {
  const card = useQuery({ queryKey: subscriberKey(id), queryFn: ({ signal }) => fetchSubscriber(id, signal) });
  if (!card.data)
    return card.error ? <LoadError error={card.error} onRetry={() => void card.refetch()} /> : <Skeleton active />;
  return <SubscriberView card={card.data} />;
}

export function SubscriberPage() {
  const canRead = useCan("subscribers.read");
  const { id = "" } = useParams();
  return canRead ? <SubscriberScreen key={id} id={id} /> : <NoAccess />;
}
