import { z } from "zod";

const ACTIVITY_PAGE_DEFAULT = 50;
const ACTIVITY_PAGE_MAX = 100;
const ARCHIVE_PAGE_DEFAULT = 50;
const ARCHIVE_PAGE_MAX = 100;
const ID_LENGTH_MAX = 100;

// Every action of the journal with its label: the screen's filter and the rows read from here (activity.md П2)
export const ACTIVITY_ACTIONS = {
  "auth.login": "Вхід",
  "auth.login_failed": "Невдала спроба входу",
  "auth.logout": "Вихід",
  "auth.logout_everywhere": "Вихід на всіх пристроях",
  "auth.session_ended": "Сесію завершено",
  "auth.password_changed": "Зміна пароля",
  "auth.password_reset": "Скидання пароля",
  "auth.password_reset_requested": "Запит на скидання пароля",
  "auth.password_reset_link_created": "Посилання для скидання пароля",
  "two_factor.enabled": "Увімкнення 2FA",
  "two_factor.reset": "Скидання 2FA",
  "two_factor.recovery_code_used": "Вхід кодом відновлення",
  "two_factor.recovery_codes_regenerated": "Нові коди відновлення",
  "user.first_admin_created": "Перший адміністратор",
  "user.invited": "Запрошення",
  "user.invitation_accepted": "Запрошення прийнято",
  "user.profile_updated": "Зміна профілю",
  "user.blocked": "Блокування",
  "user.unblocked": "Розблокування",
  "record.archived": "Архівування",
  "record.restored": "Відновлення з архіву",
  "reference.created": "Новий запис довідника",
  "reference.updated": "Зміна запису довідника",
  "reference.deactivated": "Деактивація запису довідника",
  "reference.restored": "Відновлення запису довідника",
  "reference.tariff_version_created": "Нова версія тарифу",
  "reference.price_added": "Нова ціна послуги",
  "reference.cost_added": "Нова собівартість",
  "job.run_requested": "Ручний запуск задачі",
  "system.deployed": "Нова версія",
} as const;

export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;

const ACTIVITY_ACTION_KEYS = Object.keys(ACTIVITY_ACTIONS) as ActivityAction[];

export const ACTIVITY_ENTITY_TYPES = {
  user: "Користувач",
  job: "Фонова задача",
  archive_batch: "Пакет архіву",
  program: "Програма",
  monitoring_server: "Сервер",
  tariff: "Тариф",
  addon: "Послуга",
  tracker_model: "Модель трекера",
  sim_operator: "Оператор SIM",
  sim_plan: "Тариф оператора SIM",
  contractor: "Підрядник",
  disconnect_reason: "Причина відключення",
} as const;

export type ActivityEntityType = keyof typeof ACTIVITY_ENTITY_TYPES;

const ACTIVITY_ENTITY_TYPE_KEYS = Object.keys(ACTIVITY_ENTITY_TYPES) as ActivityEntityType[];

export const activityEntityIdSchema = z.uuid("Це не схоже на ідентифікатор запису");

// Field names of the journal in the people's words; a name left out here shows as it is
export const ACTIVITY_FIELD_LABELS: Record<string, string> = {
  fullName: "ПІБ",
  status: "Статус",
  roleKey: "Роль",
  email: "Email",
  reason: "Причина",
  repeated: "Повторно",
  isKnown: "Адреса є в системі",
  codesLeft: "Лишилось кодів",
  version: "Версія",
  previousVersion: "Попередня версія",
  itemCount: "Кількість записів",
  kind: "Вид записів",
  job: "Задача",
  name: "Назва",
  note: "Примітка",
  sortOrder: "Порядок у списку",
  url: "Адреса",
  program: "Програма",
  programs: "Програми",
  server: "Сервер",
  operator: "Оператор",
  billingModel: "Період",
  priceKop: "Ціна",
  costKop: "Собівартість",
  validFrom: "Діє з",
  basedOn: "На основі тарифу",
};

// A detail that names the record: the journal shows it in the column «Запис» and not among the facts (activity.queries.ts)
export const ACTIVITY_ENTITY_LABEL_FIELD = "label";

// The moment to the microsecond, as text: a Date stops at milliseconds, and a page could then lose a row of the same one
const ACTIVITY_CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
// PostgreSQL has no year 0, and without this such a date would come back as a 500 instead of a refusal
const EARLIEST_MOMENT = "0001-01-01T00:00:00Z";

export interface ActivityCursor {
  occurredAt: string;
  id: string;
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return `${cursor.occurredAt}_${cursor.id}`;
}

export function decodeActivityCursor(value: string): ActivityCursor {
  const [occurredAt = "", id = ""] = value.split("_");
  return { occurredAt, id };
}

const activityEventBaseSchema = z.strictObject({
  id: z.string(),
  occurredAt: z.string(),
  actorKind: z.enum(["user", "system"]),
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  entityLabel: z.string().nullable(),
  // { field: [before, after] } and plain facts, kept apart: П3 leaves no value of a secret in either
  changes: z.array(z.strictObject({ field: z.string(), before: z.unknown(), after: z.unknown() })),
  details: z.array(z.strictObject({ field: z.string(), value: z.unknown() })),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type ActivityEvent = z.infer<typeof activityEventBaseSchema>;

export const activityListSchema = z.strictObject({
  items: z.array(activityEventBaseSchema),
  nextCursor: z.string().nullable(),
});
export type ActivityList = z.infer<typeof activityListSchema>;

const isSinceEarliestMoment = (moment: string) => moment >= EARLIEST_MOMENT;

// Date.parse moves 30 February on to March, and the database then refuses what passed here
const activityCursorMomentSchema = z.iso.datetime({ precision: 6 }).refine(isSinceEarliestMoment);

const activityCursorSchema = z
  .string()
  .regex(ACTIVITY_CURSOR, "Некоректний курсор")
  .refine(
    (cursor) => activityCursorMomentSchema.safeParse(decodeActivityCursor(cursor).occurredAt).success,
    "Некоректний курсор",
  );

const activityMomentSchema = z.iso
  .datetime({ error: "Некоректна дата" })
  .refine(isSinceEarliestMoment, "Некоректна дата");

// Keys match the columns of the filter row: an unknown key is refused, like everywhere else
export const activityListQuerySchema = z
  .strictObject({
    cursor: activityCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(ACTIVITY_PAGE_MAX).default(ACTIVITY_PAGE_DEFAULT),
    from: activityMomentSchema.optional(),
    // Exclusive, so that consecutive periods meet without a gap
    to: activityMomentSchema.optional(),
    actorId: z.uuid("Некоректний ідентифікатор").optional(),
    action: z.enum(ACTIVITY_ACTION_KEYS as [ActivityAction, ...ActivityAction[]]).optional(),
    entityType: z.enum(ACTIVITY_ENTITY_TYPE_KEYS as [ActivityEntityType, ...ActivityEntityType[]]).optional(),
    entityId: activityEntityIdSchema.optional(),
    subscriberId: z.uuid("Некоректний ідентифікатор").optional(),
  })
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    path: ["to"],
    message: "Кінець періоду раніше за початок",
  });
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

export const activityActorListSchema = z.strictObject({
  items: z.array(z.strictObject({ id: z.string(), fullName: z.string() })),
});
export type ActivityActorList = z.infer<typeof activityActorListSchema>;

export const archiveBatchSchema = z.strictObject({
  id: z.string(),
  entityType: z.string(),
  label: z.string(),
  itemCount: z.number(),
  archivedAt: z.string(),
  archivedByName: z.string().nullable(),
});
export type ArchiveBatch = z.infer<typeof archiveBatchSchema>;

export const archiveListSchema = z.strictObject({
  items: z.array(archiveBatchSchema),
  nextCursor: z.string().nullable(),
});
export type ArchiveList = z.infer<typeof archiveListSchema>;

export const archiveListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(ARCHIVE_PAGE_MAX).default(ARCHIVE_PAGE_DEFAULT),
});
export type ArchiveListQuery = z.infer<typeof archiveListQuerySchema>;

export const archiveBatchParamsSchema = z.strictObject({
  batchId: z.uuid("Некоректний ідентифікатор").max(ID_LENGTH_MAX),
});

export function activityActionLabel(action: string): string {
  return ACTIVITY_ACTIONS[action as ActivityAction] ?? action;
}

export function activityEntityLabel(entityType: string): string {
  return ACTIVITY_ENTITY_TYPES[entityType as ActivityEntityType] ?? entityType;
}

export function activityActorLabel(event: Pick<ActivityEvent, "actorKind" | "actorName">): string {
  return event.actorKind === "system" ? "Система" : (event.actorName ?? "-");
}

export function activityFieldLabel(field: string): string {
  return ACTIVITY_FIELD_LABELS[field] ?? field;
}
