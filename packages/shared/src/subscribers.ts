import { z } from "zod";
import { crmUrlSchema, firstContactSchema } from "./contacts.ts";
import { businessDateSchema, firstOfNextMonth, todayKyiv } from "./dates.ts";
import { ID_SERIES_MAX, SUBSCRIBER_TYPE_KEYS, type SubscriberType } from "./id-series.ts";
import { listCursorSchema, decodeListCursor } from "./list-cursor.ts";
import { MONEY_MAX_KOP, parseMoneyToKop } from "./money.ts";
import { paymentProblems, firstPayerSchema } from "./payers.ts";
import { BILLING_MODELS, emptyToNull, noteTextSchema, pageOf, versionField, type BillingModel } from "./references.ts";
import { taxIdSchema } from "./tax-id.ts";
import type { StatusMeta } from "./users.ts";

const NAME_MAX_LENGTH = 300;
const LEGACY_CODE_MAX_LENGTH = 100;
const GRACE_DAYS_MAX = 3_650;
const SEARCH_MAX_LENGTH = 100;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const DUPLICATE_VALUE_MAX_LENGTH = 500;
const NAME_TEXT = "Вкажіть назву компанії або ПІБ";
const TAX_ID_REQUIRED = "Вкажіть ЄДРПОУ або ІПН";
const GRACE_TEXT = "Вкажіть відстрочку в днях: 0 для передплати";
const DISCOUNT_TEXT = "Знижка не може бути від'ємною";
const TARIFF_DATE_TEXT = "Оберіть минулу дату, сьогодні або 1-ше число наступного місяця";
const TARIFF_REQUIRED = "Оберіть тариф";
const MANAGER_REQUIRED = "Оберіть менеджера";
const CODE_TEXT = "ID складається лише з цифр, не менше 5";
const PROGRAM_TEXT = "Оберіть програму";
const INVALID_ID = "Некоректний ідентифікатор";
const COUNTER_CURSOR = /^\d+$/;

const SUBSCRIBER_STATUS_KEYS = ["active", "partially_suspended", "suspended", "disconnected"] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUS_KEYS)[number];

export const SUBSCRIBER_STATUS_META: Record<SubscriberStatus, StatusMeta> = {
  active: { label: "Активний", tone: "good" },
  partially_suspended: { label: "Частково призупинений", tone: "warning" },
  suspended: { label: "Призупинений", tone: "warning" },
  disconnected: { label: "Відключений", tone: "neutral" },
};

export const ARCHIVED_STATUS_META: StatusMeta = { label: "В архіві", tone: "neutral" };

export interface ObjectCounts {
  objectsActive: number;
  objectsSuspended: number;
  objectsDisconnected: number;
}

// subscribers.md П17: no object at all reads the same as all of them disconnected
export function deriveSubscriberStatus({ objectsActive, objectsSuspended }: ObjectCounts): SubscriberStatus {
  if (objectsActive + objectsSuspended === 0) return "disconnected";
  if (objectsActive === 0) return "suspended";
  return objectsSuspended > 0 ? "partially_suspended" : "active";
}

const DAY_WORDS = { one: "день", few: "дні", many: "днів" } as const;
const DAY_WORD_RULES = new Intl.PluralRules("uk-UA");

function daysText(days: number): string {
  const category = DAY_WORD_RULES.select(days);
  return `${days} ${category === "one" || category === "few" ? DAY_WORDS[category] : DAY_WORDS.many}`;
}

// П29
export function paymentFormat(graceDays: number): string {
  return graceDays === 0 ? "Передплата" : `Відстрочка ${daysText(graceDays)}`;
}

export function isTariffDateAllowed(date: string, today: string): boolean {
  return date <= today || date === firstOfNextMonth(today);
}

export const tariffValidFromSchema = businessDateSchema.refine(
  (date) => isTariffDateAllowed(date, todayKyiv()),
  TARIFF_DATE_TEXT,
);

// The field of a form: text, as every sum here, and 0 is a real answer («без знижки»)
export const discountTextSchema = z.string({ error: DISCOUNT_TEXT }).refine((text) => {
  const kop = parseMoneyToKop(text);
  return kop !== null && kop <= MONEY_MAX_KOP;
}, DISCOUNT_TEXT);

export const subscriberNameSchema = z
  .string({ error: NAME_TEXT })
  .trim()
  .min(1, NAME_TEXT)
  .max(NAME_MAX_LENGTH, NAME_TEXT);
export const graceDaysSchema = z
  .number({ error: GRACE_TEXT })
  .int(GRACE_TEXT)
  .min(0, GRACE_TEXT)
  .max(GRACE_DAYS_MAX, GRACE_TEXT);
const discountKopSchema = z
  .number({ error: DISCOUNT_TEXT })
  .int(DISCOUNT_TEXT)
  .min(0, DISCOUNT_TEXT)
  .max(MONEY_MAX_KOP, DISCOUNT_TEXT);
export const legacyCodeSchema = z.string().trim().max(LEGACY_CODE_MAX_LENGTH, "Занадто довге значення");
const optionalTaxIdSchema = z.preprocess((value) => (value === "" ? null : value), taxIdSchema.nullable());

const subscriberFields = {
  type: z.enum(SUBSCRIBER_TYPE_KEYS, { error: "Оберіть тип клієнта" }),
  name: subscriberNameSchema,
  crmUrl: crmUrlSchema,
};

const refineTaxId = (subscriber: { type: SubscriberType; taxId?: string | null }, context: z.RefinementCtx) => {
  if (subscriber.type !== "B2C" && !subscriber.taxId) {
    context.addIssue({ code: "custom", path: ["taxId"], message: TAX_ID_REQUIRED });
  }
};

export const subscriberCreateSchema = z
  .strictObject({
    ...subscriberFields,
    taxId: optionalTaxIdSchema.optional(),
    // Whoever creates the client, when left out (П14)
    managerId: z.uuid(MANAGER_REQUIRED).optional(),
    graceDays: graceDaysSchema,
    discountKop: discountKopSchema.default(0),
    legacyCode: legacyCodeSchema.nullish().transform(emptyToNull),
    note: noteTextSchema.nullish().transform(emptyToNull),
    programId: z.uuid(PROGRAM_TEXT),
    tariffId: z.uuid(TARIFF_REQUIRED),
    tariffValidFrom: tariffValidFromSchema,
    contact: firstContactSchema,
    payer: firstPayerSchema,
  })
  .superRefine((subscriber, context) => {
    refineTaxId(subscriber, context);
    const { legalName, vchasnoEmail, detailsContact, paymentMethod } = subscriber.payer;
    const payer = { paymentMethod, legalName, vchasnoEmail, detailsContact, taxId: subscriber.taxId };
    for (const { field, message } of paymentProblems(payer)) {
      // The tax number of the first payer is the client's own, so that is where a person fixes it
      context.addIssue({ code: "custom", path: field === "taxId" ? ["taxId"] : ["payer", field], message });
    }
  });
export type SubscriberCreate = z.infer<typeof subscriberCreateSchema>;

// A change carries the whole record (D59). Neither the ID nor the tariff go here: each has its own route.
export const subscriberUpdateSchema = z
  .strictObject({
    ...subscriberFields,
    taxId: optionalTaxIdSchema,
    managerId: z.uuid(MANAGER_REQUIRED),
    graceDays: graceDaysSchema,
    discountKop: discountKopSchema,
    legacyCode: legacyCodeSchema.nullable().transform(emptyToNull),
    note: noteTextSchema.nullable().transform(emptyToNull),
    ...versionField,
  })
  .superRefine(refineTaxId);
export type SubscriberUpdate = z.infer<typeof subscriberUpdateSchema>;

export const subscriberTariffInputSchema = z.strictObject({
  programId: z.uuid(PROGRAM_TEXT),
  tariffId: z.uuid(TARIFF_REQUIRED),
  validFrom: tariffValidFromSchema,
});
export type SubscriberTariffInput = z.infer<typeof subscriberTariffInputSchema>;

export const subscriberCodeSchema = z
  .string({ error: CODE_TEXT })
  .trim()
  // Without a leading zero: it would drop on the way to a number, and 00123 is no five-digit ID
  .regex(/^[1-9]\d{4,14}$/, CODE_TEXT)
  .transform(Number)
  .refine((code) => code <= ID_SERIES_MAX, CODE_TEXT);

export const subscriberCodeInputSchema = z.strictObject({ code: subscriberCodeSchema, ...versionField });
export type SubscriberCodeInput = z.infer<typeof subscriberCodeInputSchema>;

export const SUBSCRIBER_SORTS = ["name", "code", "createdAt", "objects"] as const;
export type SubscriberSort = (typeof SUBSCRIBER_SORTS)[number];

export const SORT_ORDERS = ["asc", "desc"] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

const NUMERIC_SORTS: readonly SubscriberSort[] = ["code", "objects"];

const listFilters = {
  q: z.string().trim().min(1).max(SEARCH_MAX_LENGTH).optional(),
  status: z.enum(SUBSCRIBER_STATUS_KEYS).optional(),
  type: z.enum(SUBSCRIBER_TYPE_KEYS).optional(),
  programId: z.uuid(INVALID_ID).optional(),
  tariffId: z.uuid(INVALID_ID).optional(),
  managerId: z.uuid(INVALID_ID).optional(),
  archived: z.literal("true").optional(),
};

export const subscriberCountQuerySchema = z.strictObject(listFilters);
export type SubscriberCountQuery = z.infer<typeof subscriberCountQuerySchema>;

export const subscriberListQuerySchema = z
  .strictObject({
    ...listFilters,
    cursor: listCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
    sort: z.enum(SUBSCRIBER_SORTS).default("name"),
    order: z.enum(SORT_ORDERS).default("asc"),
  })
  .superRefine((query, context) => {
    if (!query.cursor || !NUMERIC_SORTS.includes(query.sort)) return;
    if (!COUNTER_CURSOR.test(decodeListCursor(query.cursor).value)) {
      context.addIssue({ code: "custom", path: ["cursor"], message: "Некоректний курсор" });
    }
  });
export type SubscriberListQuery = z.infer<typeof subscriberListQuerySchema>;

const subscriberListItemSchema = z.strictObject({
  id: z.string(),
  code: z.number(),
  legacyCode: z.string().nullable(),
  name: z.string(),
  taxId: z.string().nullable(),
  type: z.enum(SUBSCRIBER_TYPE_KEYS),
  status: z.enum(SUBSCRIBER_STATUS_KEYS),
  programName: z.string(),
  tariffName: z.string(),
  objectsActive: z.number(),
  objectsTotal: z.number(),
  managerName: z.string(),
  isArchived: z.boolean(),
});
export type SubscriberListItem = z.infer<typeof subscriberListItemSchema>;

export const subscriberListSchema = pageOf(subscriberListItemSchema);
export type SubscriberList = z.infer<typeof subscriberListSchema>;

export const subscriberCountSchema = z.strictObject({ count: z.number(), isCapped: z.boolean() });
export type SubscriberCount = z.infer<typeof subscriberCountSchema>;

const tariffVersionSchema = z.strictObject({
  id: z.string(),
  tariffId: z.string(),
  tariffName: z.string(),
  programName: z.string(),
  serverName: z.string(),
  billingModel: z.enum(Object.keys(BILLING_MODELS) as [BillingModel, ...BillingModel[]]),
  priceKop: z.number(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});
export type TariffVersion = z.infer<typeof tariffVersionSchema>;

export const subscriberCardSchema = z.strictObject({
  id: z.string(),
  version: z.number(),
  code: z.number(),
  legacyCode: z.string().nullable(),
  type: z.enum(SUBSCRIBER_TYPE_KEYS),
  name: z.string(),
  taxId: z.string().nullable(),
  crmUrl: z.string().nullable(),
  managerId: z.string(),
  managerName: z.string(),
  status: z.enum(SUBSCRIBER_STATUS_KEYS),
  programId: z.string(),
  programName: z.string(),
  tariffId: z.string(),
  // Newest first: the first one is the tariff of the client, and its date may be in the next month (П25)
  tariffHistory: z.array(tariffVersionSchema),
  graceDays: z.number(),
  discountKop: z.number(),
  note: z.string().nullable(),
  objectsActive: z.number(),
  objectsSuspended: z.number(),
  objectsDisconnected: z.number(),
  contractValidUntil: z.string().nullable(),
  contractCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isArchived: z.boolean(),
});
export type SubscriberCard = z.infer<typeof subscriberCardSchema>;

export const createdSubscriberSchema = z.strictObject({ id: z.string(), code: z.number() });
export type CreatedSubscriber = z.infer<typeof createdSubscriberSchema>;

export const subscriberCodeCheckQuerySchema = z.strictObject({
  code: z.string().max(SEARCH_MAX_LENGTH),
  excludeId: z.uuid().optional(),
});

export const subscriberCodeCheckSchema = z.strictObject({
  isValid: z.boolean(),
  isFree: z.boolean(),
  // A name only for a client this person may see
  holder: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
});
export type SubscriberCodeCheck = z.infer<typeof subscriberCodeCheckSchema>;

export const DUPLICATE_FIELDS = {
  taxId: "ЄДРПОУ / ІПН",
  phone: "Телефон",
  crmUrl: "Посилання на CRM",
  legacyCode: "Старий номер",
} as const;
export type DuplicateField = keyof typeof DUPLICATE_FIELDS;

const duplicateValueSchema = z.string().trim().max(DUPLICATE_VALUE_MAX_LENGTH).optional();

export const duplicatesQuerySchema = z.strictObject({
  taxId: duplicateValueSchema,
  phone: duplicateValueSchema,
  crmUrl: duplicateValueSchema,
  legacyCode: duplicateValueSchema,
  excludeId: z.uuid().optional(),
});
export type DuplicatesQuery = z.infer<typeof duplicatesQuerySchema>;

export const duplicateListSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      field: z.enum(Object.keys(DUPLICATE_FIELDS) as [DuplicateField, ...DuplicateField[]]),
      id: z.string(),
      code: z.number(),
      name: z.string(),
    }),
  ),
});
export type DuplicateList = z.infer<typeof duplicateListSchema>;

export const managerListSchema = z.strictObject({
  items: z.array(z.strictObject({ id: z.string(), fullName: z.string() })),
});
export type ManagerList = z.infer<typeof managerListSchema>;
