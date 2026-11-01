import { activityEntityLabel, activityFieldLabel, type ActivityEvent } from "@gps_crm/shared";
import { EMPTY_VALUE } from "../../lib/format";

export function formatActivityValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  if (typeof value === "boolean") return value ? "Так" : "Ні";
  if (typeof value === "string") return value;
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
