import type { EquipmentCheck } from "@gps_crm/shared";

const CHECKSUM_TEXT = "Перевірте IMEI: контрольна цифра не збігається";
const FREE_TEXT = "Цей запис уже є і вільний: його й буде встановлено";
const ARCHIVED_TEXT = "Цей запис в архіві: спершу відновіть його";
const TAKEN_TEXT = "Такий номер уже є";

export interface NumberHintText {
  type: "warning" | "info";
  text: string;
  objectId?: string | null;
}

// A record in the stock: nothing more to type about it, and an object takes it as it is
export function isFreeRecord(result: EquipmentCheck | undefined): boolean {
  return Boolean(result?.holder && !result.holder.isArchived && !result.holder.label);
}

export function hintOf(result: EquipmentCheck | undefined, isForInstallation: boolean): NumberHintText | null {
  if (!result?.isValid) return null;
  const { holder, hasChecksumWarning } = result;
  if (!holder) return hasChecksumWarning ? { type: "warning", text: CHECKSUM_TEXT } : null;
  if (holder.isArchived) return { type: "warning", text: ARCHIVED_TEXT };
  if (holder.label) return { type: "warning", text: `Уже встановлено: ${holder.label}`, objectId: holder.objectId };
  return isForInstallation ? { type: "info", text: FREE_TEXT } : { type: "warning", text: TAKEN_TEXT };
}
