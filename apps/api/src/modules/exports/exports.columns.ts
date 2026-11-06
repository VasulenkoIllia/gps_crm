import {
  ARCHIVED_STATUS_META,
  CONTRACT_STATUS_META,
  DEVICE_OWNERSHIPS,
  DEVICE_STATUS_META,
  OBJECT_STATUS_META,
  SIM_STATUS_META,
  subscriberStatusMeta,
  SUBSCRIBER_TYPES,
  todayKyiv,
  type Contract,
  type DeviceRow,
  type EquipmentPlace,
  type ObjectListItem,
  type SensorRow,
  type SimRow,
  type StatusMeta,
  type SubscriberListItem,
} from "@gps_crm/shared";

export type Cell = string | number | Date | null;

export interface ColumnHead {
  header: string;
  width: number;
  isDate?: boolean;
}

export interface Column<T> extends ColumnHead {
  value: (row: T) => Cell;
}

// П3: a text that starts as a formula stays a text in whatever program opens the file
const FORMULA_START = /^[=+\-@]/;
// A phone number as the app keeps it, +380...: a number to any program, never a formula, and a prefix would show
const PHONE_NUMBER = /^\+\d+$/;

export function safeCell(cell: Cell): Cell {
  return typeof cell === "string" && FORMULA_START.test(cell) && !PHONE_NUMBER.test(cell) ? `'${cell}` : cell;
}

// A business date as a date of Excel, so the file sorts and filters by it. Midnight UTC: Excel has no time zones.
export function excelDate(date: string | null | undefined): Date | null {
  if (!date) return null;
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

const dayOf = (moment: string) => excelDate(todayKyiv(new Date(moment)));
const yesNo = (value: boolean) => (value ? "так" : "ні");
const statusOf = (meta: StatusMeta, isArchived: boolean) => (isArchived ? ARCHIVED_STATUS_META : meta).label;

const NAME_WIDTH = 36;
const CODE_WIDTH = 12;
const NUMBER_WIDTH = 22;
const TEXT_WIDTH = 20;
const DATE_WIDTH = 14;
const COUNT_WIDTH = 10;

// П2: the columns of the screen and the service ones, the client's ID and old number and the dates
export const SUBSCRIBER_COLUMNS: Column<SubscriberListItem>[] = [
  { header: "ID", width: CODE_WIDTH, value: (row) => row.code },
  { header: "Старий номер", width: CODE_WIDTH, value: (row) => row.legacyCode },
  { header: "Назва", width: NAME_WIDTH, value: (row) => row.name },
  { header: "ЄДРПОУ / ІПН", width: CODE_WIDTH, value: (row) => row.taxId },
  { header: "Тип", width: TEXT_WIDTH, value: (row) => SUBSCRIBER_TYPES[row.type] },
  {
    header: "Статус",
    width: TEXT_WIDTH,
    value: (row) => subscriberStatusMeta(row.status, row.objectsTotal, row.isArchived).label,
  },
  { header: "Програма", width: TEXT_WIDTH, value: (row) => row.programName },
  { header: "Тариф", width: TEXT_WIDTH, value: (row) => row.tariffName },
  { header: "Активних об'єктів", width: COUNT_WIDTH, value: (row) => row.objectsActive },
  { header: "Усього об'єктів", width: COUNT_WIDTH, value: (row) => row.objectsTotal },
  { header: "Менеджер", width: TEXT_WIDTH, value: (row) => row.managerName },
  { header: "Створено", width: DATE_WIDTH, isDate: true, value: (row) => dayOf(row.createdAt) },
];

export const OBJECT_COLUMNS: Column<ObjectListItem>[] = [
  { header: "Назва", width: NAME_WIDTH, value: (row) => row.name },
  { header: "ID клієнта", width: CODE_WIDTH, value: (row) => row.subscriberCode },
  { header: "Клієнт", width: NAME_WIDTH, value: (row) => row.subscriberName },
  { header: "Програма", width: TEXT_WIDTH, value: (row) => row.programName },
  { header: "Тариф", width: TEXT_WIDTH, value: (row) => row.tariffName },
  { header: "Власний тариф", width: COUNT_WIDTH, value: (row) => yesNo(row.hasOwnTariff) },
  { header: "Послуги", width: TEXT_WIDTH, value: (row) => row.addonNames.join(", ") || null },
  { header: "Модель трекера", width: TEXT_WIDTH, value: (row) => row.modelName },
  { header: "IMEI", width: NUMBER_WIDTH, value: (row) => row.imei },
  { header: "Статус", width: TEXT_WIDTH, value: (row) => statusOf(OBJECT_STATUS_META[row.status], row.isArchived) },
  { header: "Статус з", width: DATE_WIDTH, isDate: true, value: (row) => excelDate(row.statusFrom) },
  { header: "Дата підключення", width: DATE_WIDTH, isDate: true, value: (row) => excelDate(row.connectedOn) },
  { header: "Створено", width: DATE_WIDTH, isDate: true, value: (row) => dayOf(row.createdAt) },
];

// Where a piece of equipment stands, as the column «Де встановлено» of the screen, split for a sheet
function placeColumns<T extends { place: EquipmentPlace | null }>(): Column<T>[] {
  return [
    { header: "Об'єкт", width: NAME_WIDTH, value: (row) => row.place?.objectName ?? null },
    { header: "ID клієнта", width: CODE_WIDTH, value: (row) => row.place?.subscriberCode ?? null },
    { header: "Клієнт", width: NAME_WIDTH, value: (row) => row.place?.subscriberName ?? null },
    { header: "Встановлено", width: DATE_WIDTH, isDate: true, value: (row) => excelDate(row.place?.installedOn) },
    { header: "Підрядник", width: TEXT_WIDTH, value: (row) => row.place?.contractorName ?? null },
  ];
}

export const DEVICE_COLUMNS: Column<DeviceRow>[] = [
  { header: "IMEI", width: NUMBER_WIDTH, value: (row) => row.imei },
  { header: "Модель", width: TEXT_WIDTH, value: (row) => row.modelName },
  { header: "Власність", width: TEXT_WIDTH, value: (row) => (row.ownership ? DEVICE_OWNERSHIPS[row.ownership] : null) },
  { header: "Стан", width: TEXT_WIDTH, value: (row) => statusOf(DEVICE_STATUS_META[row.status], row.isArchived) },
  ...placeColumns<DeviceRow>(),
  { header: "Примітка", width: NAME_WIDTH, value: (row) => row.note },
];

export const SIM_COLUMNS: Column<SimRow>[] = [
  { header: "ICCID", width: NUMBER_WIDTH, value: (row) => row.iccid },
  { header: "Номер SIM", width: TEXT_WIDTH, value: (row) => row.msisdn },
  { header: "Оператор", width: TEXT_WIDTH, value: (row) => row.operatorName },
  { header: "Тариф оператора", width: TEXT_WIDTH, value: (row) => row.planName },
  { header: "Стан", width: TEXT_WIDTH, value: (row) => statusOf(SIM_STATUS_META[row.status], row.isArchived) },
  { header: "IMEI трекера", width: NUMBER_WIDTH, value: (row) => row.deviceImei },
  ...placeColumns<SimRow>(),
  { header: "Примітка", width: NAME_WIDTH, value: (row) => row.note },
];

export const SENSOR_COLUMNS: Column<SensorRow>[] = [
  { header: "Серійний номер", width: NUMBER_WIDTH, value: (row) => row.serialNo },
  ...placeColumns<SensorRow>(),
  { header: "Примітка", width: NAME_WIDTH, value: (row) => row.note },
  { header: "В архіві", width: COUNT_WIDTH, value: (row) => yesNo(row.isArchived) },
];

export const CONTRACT_COLUMNS: Column<Contract>[] = [
  { header: "Номер", width: TEXT_WIDTH, value: (row) => row.number },
  { header: "ID клієнта", width: CODE_WIDTH, value: (row) => row.subscriber.code },
  { header: "Клієнт", width: NAME_WIDTH, value: (row) => row.subscriber.name },
  { header: "Платник", width: NAME_WIDTH, value: (row) => row.payer.name },
  { header: "ЄДРПОУ / ІПН платника", width: CODE_WIDTH, value: (row) => row.payer.taxId },
  { header: "Статус", width: TEXT_WIDTH, value: (row) => statusOf(CONTRACT_STATUS_META[row.status], row.isArchived) },
  { header: "Спливає", width: COUNT_WIDTH, value: (row) => yesNo(row.isExpiring) },
  { header: "Підписано", width: DATE_WIDTH, isDate: true, value: (row) => excelDate(row.signedOn) },
  { header: "Діє до", width: DATE_WIDTH, isDate: true, value: (row) => excelDate(row.validUntil) },
  { header: "Розірвано", width: DATE_WIDTH, isDate: true, value: (row) => excelDate(row.terminatedOn) },
  { header: "Файл", width: TEXT_WIDTH, value: (row) => row.fileName },
  { header: "Примітка", width: NAME_WIDTH, value: (row) => row.note },
];
