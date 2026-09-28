// Role → permission matrix. The client has only defined "Admin = everything" (sheet 05);
// the manager / tech rows are a proposal to discuss (questions 6.1–6.4).
import type { RoleId } from "./types";

export type Permission =
  | "subscribers.all"
  | "subscribers.edit"
  | "objects.edit"
  | "equipment.edit"
  | "finance.view"
  | "cost.view"
  | "payments.edit"
  | "mailings.send"
  | "references.edit"
  | "records.delete"
  | "users.manage";

export const PERMISSIONS: { id: Permission; group: string; label: string; question?: string }[] = [
  { id: "subscribers.all", group: "Абоненти", label: "Бачить усіх абонентів (а не лише своїх)", question: "6.1" },
  { id: "subscribers.edit", group: "Абоненти", label: "Створює та редагує абонентів, контакти, договори" },
  { id: "objects.edit", group: "Об'єкти", label: "Змінює об'єкти: статус, тариф, послуги", question: "6.3" },
  { id: "equipment.edit", group: "Об'єкти", label: "Облік обладнання та SIM, заміна трекера" },
  { id: "finance.view", group: "Фінанси", label: "Бачить оплати, борги, оборот, LTV", question: "6.3" },
  { id: "cost.view", group: "Фінанси", label: "Бачить собівартість і маржу", question: "6.2" },
  { id: "payments.edit", group: "Фінанси", label: "Вносить оплати" },
  { id: "mailings.send", group: "Розсилки", label: "Запускає масові розсилки", question: "5.6" },
  { id: "references.edit", group: "Налаштування", label: "Редагує тарифи та довідники" },
  { id: "records.delete", group: "Налаштування", label: "Видаляє записи", question: "6.4" },
  { id: "users.manage", group: "Налаштування", label: "Керує користувачами та правами" },
];

export type RoleMatrix = Record<RoleId, Permission[]>;

export const DEFAULT_ROLE_MATRIX: RoleMatrix = {
  admin: PERMISSIONS.map((p) => p.id),
  manager: ["subscribers.edit", "finance.view", "payments.edit", "mailings.send"],
  tech: ["subscribers.all", "objects.edit", "equipment.edit"],
};

export const ROLE_LABELS: Record<RoleId, string> = {
  admin: "Адміністратор",
  manager: "Менеджер",
  tech: "Технічний спеціаліст",
};
