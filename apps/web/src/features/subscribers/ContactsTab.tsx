import {
  ARCHIVED_STATUS_META,
  CONTACT_CHANNELS,
  CONTACT_STATUS_META,
  type Contact,
  type StatusMeta,
  type SubscriberCard,
} from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { useCan } from "../../lib/session";
import { DataTable, EmptyValue, ExternalLink, Phone, RowActions, StatusTag, type DataTableColumn } from "../../ui";
import { ContactForm } from "./ContactForm";
import { contactAction, contactsKey, deleteContact, fetchContacts } from "./subscribers.api";
import { useConfirmedAction, type PlannedAction } from "./useConfirmedAction";

type ContactActionKey = "edit" | "primary" | "archive" | "restore" | "delete";

const PRIMARY_META: StatusMeta = { label: "Основна", tone: "pending" };

interface ContactRights {
  canWrite: boolean;
  canArchive: boolean;
  canDelete: boolean;
}

function actionsOf(contact: Contact, { canWrite, canArchive, canDelete }: ContactRights) {
  const isLive = !contact.isArchived;
  const all: { key: ContactActionKey; label: string; isOn: boolean }[] = [
    { key: "edit", label: "Змінити", isOn: canWrite && isLive },
    { key: "primary", label: "Зробити основною", isOn: canWrite && isLive && !contact.isPrimary },
    { key: "archive", label: "Архівувати", isOn: canArchive && isLive },
    { key: "restore", label: "Відновити", isOn: canArchive && !isLive },
    { key: "delete", label: "Видалити", isOn: canDelete && isLive },
  ];
  return all.filter(({ isOn }) => isOn);
}

function planFor(contact: Contact, key: Exclude<ContactActionKey, "edit">): PlannedAction {
  const { id, fullName } = contact;
  const plans: Record<typeof key, PlannedAction> = {
    primary: {
      title: `Зробити основною: ${fullName}?`,
      consequence: "Попередня основна особа перестане бути основною.",
      actionLabel: "Зробити основною",
      doneText: "Основну особу змінено",
      run: () => contactAction(id, "make-primary"),
    },
    archive: {
      title: `Архівувати: ${fullName}?`,
      consequence: "Контакт зникне з роботи, повернути його можна з архіву.",
      actionLabel: "Архівувати",
      doneText: "Контакт в архіві",
      run: () => contactAction(id, "archive"),
    },
    restore: {
      title: `Відновити: ${fullName}?`,
      consequence: "Контакт повернеться до роботи.",
      actionLabel: "Відновити",
      doneText: "Контакт відновлено",
      run: () => contactAction(id, "restore"),
    },
    delete: {
      title: `Видалити: ${fullName}?`,
      consequence: "Запис буде видалено назавжди.",
      actionLabel: "Видалити",
      doneText: "Контакт видалено",
      isDanger: true,
      run: () => deleteContact(id),
    },
  };
  return plans[key];
}

function statusOf(contact: Contact) {
  if (contact.isArchived) return ARCHIVED_STATUS_META;
  return contact.isActive ? CONTACT_STATUS_META.active : CONTACT_STATUS_META.inactive;
}

function joined(parts: (string | false | null)[]) {
  return parts.filter(Boolean).join(", ") || <EmptyValue />;
}

function buildColumns(rights: ContactRights, onAction: (row: Contact, key: ContactActionKey) => void) {
  const columns: DataTableColumn<Contact>[] = [
    {
      title: "ПІБ",
      key: "fullName",
      render: (_, row) => (
        <>
          {row.fullName} {row.isPrimary && <StatusTag status={PRIMARY_META} />}
        </>
      ),
    },
    { title: "Посада", key: "position", render: (_, row) => row.position ?? <EmptyValue /> },
    {
      title: "Телефони",
      key: "phones",
      render: (_, row) => (
        <>
          <Phone value={row.phone} />
          {row.phone2 && (
            <div>
              <Phone value={row.phone2} />
            </div>
          )}
        </>
      ),
    },
    { title: "Email", key: "email", render: (_, row) => row.email ?? <EmptyValue /> },
    {
      title: "Канал",
      key: "channel",
      render: (_, row) => (row.channel ? CONTACT_CHANNELS[row.channel] : <EmptyValue />),
    },
    {
      title: "Chat ID",
      key: "chats",
      render: (_, row) => joined([row.telegramChatId && "Telegram", row.viberChatId && "Viber"]),
    },
    {
      title: "Отримує",
      key: "notify",
      render: (_, row) => joined([row.billingNotify && "оплата", row.techNotify && "технічні"]),
    },
    { title: "Статус", key: "status", render: (_, row) => <StatusTag status={statusOf(row)} /> },
    { title: "CRM", key: "crm", render: (_, row) => <ExternalLink href={row.crmUrl}>Відкрити</ExternalLink> },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, row) => (
        <RowActions rowName={row.fullName} actions={actionsOf(row, rights)} onAction={(key) => onAction(row, key)} />
      ),
    },
  ];
  return columns;
}

export function ContactsTab({ card }: { card: SubscriberCard }) {
  const canWriteAny = useCan("subscribers.write");
  const canArchive = useCan("records.archive");
  const canDelete = useCan("records.delete");
  const canWrite = canWriteAny && !card.isArchived;
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const confirm = useConfirmedAction();
  const contacts = useQuery({
    queryKey: contactsKey(card.id),
    queryFn: ({ signal }) => fetchContacts(card.id, signal),
  });
  const ask = confirm.ask;
  const columns = useMemo(
    () =>
      buildColumns({ canWrite, canArchive, canDelete }, (row, key) =>
        key === "edit" ? setEditing(row) : ask(planFor(row, key)),
      ),
    [canWrite, canArchive, canDelete, ask],
  );

  return (
    <>
      {canWrite && (
        <div className="tab-actions">
          <Button onClick={() => setEditing("new")}>Додати контакт</Button>
        </div>
      )}
      <DataTable
        rows={contacts.data?.items}
        columns={columns}
        rowKey="id"
        error={contacts.error}
        empty="Контактів ще немає"
        onRetry={() => void contacts.refetch()}
      />
      <ContactForm
        key={editing === "new" ? "new" : editing?.id}
        subscriberId={card.id}
        clientCrmUrl={card.crmUrl}
        row={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      {confirm.dialog}
    </>
  );
}
