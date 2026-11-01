import {
  ARCHIVED_STATUS_META,
  OBJECT_STATUS_META,
  type ObjectCard,
  type ObjectListItem,
  type ObjectStatus,
} from "@gps_crm/shared";
import { DateText, DateTimeText, EmptyValue, EntityLink, StatusTag, type DataTableColumn } from "../../ui";

interface StatusFacts {
  status: ObjectStatus;
  statusFrom: string;
  isArchived: boolean;
}

export function ObjectStatusTag({ status, statusFrom, isArchived }: StatusFacts) {
  return (
    <>
      <StatusTag status={isArchived ? ARCHIVED_STATUS_META : OBJECT_STATUS_META[status]} />
      <div className="table-note">
        з <DateText value={statusFrom} />
      </div>
    </>
  );
}

// The tariff of the client is the rule, so only the exception carries a word
export function tariffText({ tariffName, isOwn }: Pick<ObjectCard["tariff"], "tariffName" | "isOwn">): string {
  return isOwn ? `${tariffName} (свій)` : tariffName;
}

const NAME_COLUMN: DataTableColumn<ObjectListItem> = {
  title: "Назва",
  key: "name",
  sorter: true,
  render: (_, row) => <EntityLink to={`/objects/${row.id}`}>{row.name}</EntityLink>,
};

const CLIENT_COLUMN: DataTableColumn<ObjectListItem> = {
  title: "Клієнт",
  key: "subscriber",
  sorter: true,
  render: (_, row) => (
    <>
      <EntityLink to={`/subscribers/${row.subscriberId}`}>{row.subscriberCode}</EntityLink>
      <div className="table-note">{row.subscriberName}</div>
    </>
  ),
};

const DETAIL_COLUMNS: DataTableColumn<ObjectListItem>[] = [
  { title: "Програма", dataIndex: "programName" },
  {
    title: "Тариф і послуги",
    key: "tariff",
    render: (_, row) => (
      <>
        {tariffText({ tariffName: row.tariffName, isOwn: row.hasOwnTariff })}
        {row.addonNames.length > 0 && <div className="table-note">{row.addonNames.join(", ")}</div>}
      </>
    ),
  },
  {
    title: "Трекер",
    key: "device",
    render: (_, row) => (
      <>
        {row.modelName ?? <EmptyValue />}
        {row.imei && <div className="table-note">{row.imei}</div>}
      </>
    ),
  },
  {
    title: "Статус",
    key: "status",
    render: (_, row) => <ObjectStatusTag status={row.status} statusFrom={row.statusFrom} isArchived={row.isArchived} />,
  },
  { title: "Підключено", key: "connectedOn", sorter: true, render: (_, row) => <DateText value={row.connectedOn} /> },
  { title: "Створено", key: "createdAt", sorter: true, render: (_, row) => <DateTimeText value={row.createdAt} /> },
];

export const OBJECT_COLUMNS = [NAME_COLUMN, CLIENT_COLUMN, ...DETAIL_COLUMNS];

// In the card of a client the client goes without saying, and the server sorts only the whole list
export const CLIENT_OBJECT_COLUMNS: DataTableColumn<ObjectListItem>[] = [NAME_COLUMN, ...DETAIL_COLUMNS].map(
  (column) => ({ ...column, sorter: false }),
);
