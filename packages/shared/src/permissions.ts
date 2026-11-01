// The registry of permissions and roles (04-access-audit.md §4.2). Stage 1 gives every role every permission (D14);
// a migration seeds them, and access.int.test.ts holds the database to this list.
export const ACCESS_SCOPE = { all: "all", own: "own" } as const;

export type AccessScope = (typeof ACCESS_SCOPE)[keyof typeof ACCESS_SCOPE];

interface PermissionDefinition {
  group: string;
  label: string;
  scopes: readonly AccessScope[];
}

const ALL_ONLY = [ACCESS_SCOPE.all] as const;
const ALL_OR_OWN = [ACCESS_SCOPE.all, ACCESS_SCOPE.own] as const;

export const PERMISSIONS = {
  "subscribers.read": { group: "Клієнти", label: "Перегляд клієнтів", scopes: ALL_OR_OWN },
  "subscribers.write": { group: "Клієнти", label: "Зміна клієнтів", scopes: ALL_OR_OWN },
  "subscribers.code.change": { group: "Клієнти", label: "Ручна зміна ID клієнта", scopes: ALL_OR_OWN },
  "objects.read": { group: "Об'єкти", label: "Перегляд об'єктів", scopes: ALL_OR_OWN },
  "objects.write": { group: "Об'єкти", label: "Зміна об'єктів", scopes: ALL_OR_OWN },
  "objects.status.change": { group: "Об'єкти", label: "Зміна статусу об'єкта", scopes: ALL_OR_OWN },
  "equipment.read": { group: "Обладнання", label: "Перегляд обладнання", scopes: ALL_ONLY },
  "equipment.write": { group: "Обладнання", label: "Зміна обладнання", scopes: ALL_ONLY },
  "references.manage": { group: "Довідники", label: "Керування довідниками", scopes: ALL_ONLY },
  "records.archive": { group: "Записи", label: "Архівування записів", scopes: ALL_OR_OWN },
  "records.delete": { group: "Записи", label: "Видалення записів", scopes: ALL_OR_OWN },
  "data.export": { group: "Записи", label: "Експорт даних", scopes: ALL_OR_OWN },
  "cost.read": { group: "Фінанси", label: "Перегляд собівартості", scopes: ALL_ONLY },
  "activity.read": { group: "Система", label: "Перегляд журналу дій", scopes: ALL_OR_OWN },
  "users.manage": { group: "Система", label: "Керування користувачами", scopes: ALL_ONLY },
  "system.read": { group: "Система", label: "Перегляд стану системи", scopes: ALL_ONLY },
} as const satisfies Record<string, PermissionDefinition>;

export type PermissionKey = keyof typeof PERMISSIONS;

export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLES = {
  admin: { name: "Адміністратор" },
  manager: { name: "Менеджер" },
  technician: { name: "Технічний спеціаліст" },
} as const;

export type RoleKey = keyof typeof ROLES;

export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];
