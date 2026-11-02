import {
  CONTRACT_EXPIRY_DAYS,
  CONTRACT_STATUS_META,
  dateText,
  DEVICE_STATUS_META,
  OBJECT_STATUS_META,
  SIM_STATUS_META,
  SUBSCRIBER_STATUS_META,
  SUBSCRIBER_TYPES,
  type ExportEntity,
  type ExportRequest,
  type StatusMeta,
} from "@gps_crm/shared";

// The labels of the filter rows of the screens
const FILTER_LABELS: Record<string, string> = {
  q: "Пошук",
  status: "Статус",
  type: "Тип",
  programId: "Програма",
  serverId: "Сервер",
  tariffId: "Тариф",
  modelId: "Модель",
  addonId: "Послуга",
  subscriberId: "Клієнт",
  managerId: "Менеджер",
  operatorId: "Оператор",
  contractorId: "Підрядник",
  archived: "Архів",
  expiring: "Спливають",
  signedFrom: "Підписано від",
  signedTo: "Підписано до",
};

const STATUS_LABELS: Record<ExportEntity, Record<string, StatusMeta> | null> = {
  subscribers: SUBSCRIBER_STATUS_META,
  objects: OBJECT_STATUS_META,
  devices: DEVICE_STATUS_META,
  sims: SIM_STATUS_META,
  sensors: null,
  contracts: CONTRACT_STATUS_META,
};

// The filters that name a record by its id: the journal shows its name instead
export function referencedIds(request: ExportRequest): [string, string][] {
  return Object.entries(request.filters).filter(
    (entry): entry is [string, string] => entry[0].endsWith("Id") && typeof entry[1] === "string",
  );
}

function valueText(entity: ExportEntity, key: string, value: string, names: Map<string, string>): string {
  if (key === "q") return `«${value}»`;
  if (key === "archived") return "в архіві";
  if (key === "expiring") return `за ${String(CONTRACT_EXPIRY_DAYS)} днів`;
  if (key === "signedFrom" || key === "signedTo") return dateText(value);
  if (key === "status") return STATUS_LABELS[entity]?.[value]?.label ?? value;
  if (key === "type") return SUBSCRIBER_TYPES[value as keyof typeof SUBSCRIBER_TYPES] ?? value;
  // A record deleted since the request: its id is still the truth about the filter
  return names.get(value) ?? value;
}

// search-exports.md П4: «з якими фільтрами», in the words of the screen. Null: the whole list.
export function describeFilters(request: ExportRequest, names: Map<string, string>): string | null {
  const parts = Object.entries(request.filters).flatMap(([key, value]) =>
    typeof value === "string" ? [`${FILTER_LABELS[key] ?? key}: ${valueText(request.entity, key, value, names)}`] : [],
  );
  return parts.length > 0 ? parts.join("; ") : null;
}
