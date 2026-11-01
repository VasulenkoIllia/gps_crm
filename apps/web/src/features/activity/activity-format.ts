import {
  activityEntityLabel,
  activityFieldLabel,
  BILLING_MODELS,
  formatMoney,
  type ActivityEvent,
  type BillingModel,
} from "@gps_crm/shared";
import { formatDate } from "../../lib/dayjs";
import { EMPTY_VALUE } from "../../lib/format";

const TEXT_BY_FIELD: Record<string, (value: string) => string> = {
  validFrom: formatDate,
  billingModel: (value) => BILLING_MODELS[value as BillingModel] ?? value,
  kind: activityEntityLabel,
};

const MONEY_FIELD = /Kop$/;

// The journal keeps values as they are stored, and only the screen knows that 16000 in a price means 160,00 грн
export function formatActivityValue(value: unknown, field = ""): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "Так" : "Ні";
  if (typeof value === "number" && MONEY_FIELD.test(field)) return formatMoney(value);
  if (typeof value === "string") return TEXT_BY_FIELD[field]?.(value) ?? value;
  return JSON.stringify(value);
}

export function entityText(event: Pick<ActivityEvent, "entityType" | "entityLabel">): string {
  if (!event.entityType) return EMPTY_VALUE;
  const kind = activityEntityLabel(event.entityType);
  return event.entityLabel ? `${kind}: ${event.entityLabel}` : kind;
}

export function changeSummary(event: Pick<ActivityEvent, "changes">): string {
  return event.changes.map(({ field }) => activityFieldLabel(field)).join(", ") || EMPTY_VALUE;
}
