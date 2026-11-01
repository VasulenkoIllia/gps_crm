import { z } from "zod";
import type { ActivityEntityType } from "./activity.ts";
import { businessDateSchema } from "./dates.ts";
import { amountKopSchema } from "./money.ts";

const REFERENCE_PAGE_DEFAULT = 200;
// A form asks for one whole list at this size: the lists are short, each is typed in by hand
export const REFERENCE_PAGE_MAX = 500;
const NAME_MAX_LENGTH = 200;
const NOTE_MAX_LENGTH = 1_000;
const URL_MAX_LENGTH = 500;
const SORT_ORDER_MAX = 9_999;
const LONG_VALUE = "Занадто довге значення";
const NAME_REQUIRED = "Вкажіть назву";

// The ones that hold a name, a note and a place in the list and nothing else (references.md §3)
export const SIMPLE_REFERENCE_KINDS = [
  "programs",
  "tracker-models",
  "sim-operators",
  "contractors",
  "disconnect-reasons",
] as const;
export type SimpleReferenceKind = (typeof SIMPLE_REFERENCE_KINDS)[number];

export const REFERENCE_KINDS = [
  "programs",
  "servers",
  "tariffs",
  "addons",
  "tracker-models",
  "sim-operators",
  "sim-plans",
  "contractors",
  "disconnect-reasons",
] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

// The name of a kind in the journal and the archive
export const REFERENCE_ENTITY_TYPES = {
  programs: "program",
  servers: "monitoring_server",
  tariffs: "tariff",
  addons: "addon",
  "tracker-models": "tracker_model",
  "sim-operators": "sim_operator",
  "sim-plans": "sim_plan",
  contractors: "contractor",
  "disconnect-reasons": "disconnect_reason",
} as const satisfies Record<ReferenceKind, ActivityEntityType>;

export const BILLING_MODELS = { month: "Місяць", year: "Рік" } as const;
export type BillingModel = keyof typeof BILLING_MODELS;

const BILLING_MODEL_KEYS = Object.keys(BILLING_MODELS) as BillingModel[];

export const COST_SUBJECT_TYPES = ["server", "sim_plan", "addon"] as const;
export type CostSubjectType = (typeof COST_SUBJECT_TYPES)[number];

export const REFERENCE_STATUS = { active: "active", inactive: "inactive" } as const;

export const REFERENCE_STATUS_META = {
  active: { label: "Активний", tone: "good" },
  inactive: { label: "Деактивований", tone: "neutral" },
} as const;

export const referenceListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(REFERENCE_PAGE_MAX).default(REFERENCE_PAGE_DEFAULT),
  status: z.enum([REFERENCE_STATUS.active, REFERENCE_STATUS.inactive]).optional(),
});
export type ReferenceListQuery = z.infer<typeof referenceListQuerySchema>;

const baseFields = {
  id: z.string(),
  version: z.number(),
  name: z.string(),
  isActive: z.boolean(),
};

const simpleFields = { ...baseFields, note: z.string().nullable(), sortOrder: z.number() };

const priceEntrySchema = z.strictObject({ id: z.string(), amountKop: z.number(), validFrom: z.string() });
export type PriceEntry = z.infer<typeof priceEntrySchema>;

// Null for a person without `cost.read`: the block is hidden, not empty (references.md §7)
const costsField = z.array(priceEntrySchema).nullable();

const simpleReferenceSchema = z.strictObject(simpleFields);
export type SimpleReference = z.infer<typeof simpleReferenceSchema>;

const serverSchema = z.strictObject({
  ...baseFields,
  programId: z.string(),
  programName: z.string(),
  url: z.string().nullable(),
  costs: costsField,
});
export type Server = z.infer<typeof serverSchema>;

const tariffSchema = z.strictObject({
  ...baseFields,
  programId: z.string(),
  programName: z.string(),
  serverId: z.string(),
  serverName: z.string(),
  billingModel: z.enum(BILLING_MODEL_KEYS),
  priceKop: z.number(),
  // Chosen for a client or an object at least once: from then on the price stands (references.md П9)
  isSelected: z.boolean(),
  // Clients outside the archive whose latest version of the tariff is this one (references.md §5)
  clientCount: z.number(),
});
export type Tariff = z.infer<typeof tariffSchema>;

const addonSchema = z.strictObject({
  ...baseFields,
  programs: z.array(z.strictObject({ id: z.string(), name: z.string() })),
  prices: z.array(priceEntrySchema),
  costs: costsField,
});
export type Addon = z.infer<typeof addonSchema>;

const simPlanSchema = z.strictObject({
  ...simpleFields,
  operatorId: z.string(),
  operatorName: z.string(),
  costs: costsField,
});
export type SimPlan = z.infer<typeof simPlanSchema>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });

export const simpleReferenceListSchema = pageOf(simpleReferenceSchema);
export const serverListSchema = pageOf(serverSchema);
export const tariffListSchema = pageOf(tariffSchema);
export const addonListSchema = pageOf(addonSchema);
export const simPlanListSchema = pageOf(simPlanSchema);

export type SimpleReferenceList = z.infer<typeof simpleReferenceListSchema>;
export type ServerList = z.infer<typeof serverListSchema>;
export type TariffList = z.infer<typeof tariffListSchema>;
export type AddonList = z.infer<typeof addonListSchema>;
export type SimPlanList = z.infer<typeof simPlanListSchema>;

export const createdReferenceSchema = z.strictObject({ id: z.string() });
export type CreatedReference = z.infer<typeof createdReferenceSchema>;

export const referenceNameSchema = z
  .string({ error: NAME_REQUIRED })
  .trim()
  .min(1, NAME_REQUIRED)
  .max(NAME_MAX_LENGTH, LONG_VALUE);

export const PROGRAM_REQUIRED = "Оберіть програму";
export const SERVER_REQUIRED = "Оберіть сервер";
export const OPERATOR_REQUIRED = "Оберіть оператора";

const programIdSchema = z.uuid(PROGRAM_REQUIRED);
const serverIdSchema = z.uuid(SERVER_REQUIRED);
const operatorIdSchema = z.uuid(OPERATOR_REQUIRED);

export const emptyToNull = (value: string | null | undefined) => value || null;

export const noteTextSchema = z.string().trim().max(NOTE_MAX_LENGTH, LONG_VALUE);

const sortOrderSchema = z
  .number({ error: "Вкажіть ціле число" })
  .int("Вкажіть ціле число")
  .min(0, "Вкажіть ціле число")
  .max(SORT_ORDER_MAX, "Занадто велике значення");

const urlTextSchema = z
  .string()
  .trim()
  .max(URL_MAX_LENGTH, LONG_VALUE)
  .regex(/^(https?:\/\/.+)?$/, "Адреса починається з http:// або https://");

export const serverUrlSchema = urlTextSchema.nullish().transform(emptyToNull);

export const versionField = { version: z.number().int().positive() };

// A price or a cost from a date. Past dates are history being typed in, future ones a planned change (references.md П3).
export const datedPriceSchema = z.strictObject({ amountKop: amountKopSchema, validFrom: businessDateSchema });
export type DatedPrice = z.infer<typeof datedPriceSchema>;

const firstCostField = { firstCost: datedPriceSchema.optional() };

const simpleFieldsInput = {
  name: referenceNameSchema,
  note: noteTextSchema.nullish().transform(emptyToNull),
  sortOrder: sortOrderSchema.default(0),
};

// A change carries the whole record: a field left out is refused here, because a default would erase what it held
const simpleFieldsUpdate = {
  name: referenceNameSchema,
  note: noteTextSchema.nullable().transform(emptyToNull),
  sortOrder: sortOrderSchema,
};

export const simpleReferenceInputSchema = z.strictObject(simpleFieldsInput);
export type SimpleReferenceInput = z.infer<typeof simpleReferenceInputSchema>;

export const simpleReferenceUpdateSchema = z.strictObject({ ...simpleFieldsUpdate, ...versionField });
export type SimpleReferenceUpdate = z.infer<typeof simpleReferenceUpdateSchema>;

const serverPlaceInput = { programId: programIdSchema, name: referenceNameSchema };

export const serverCreateSchema = z.strictObject({ ...serverPlaceInput, url: serverUrlSchema, ...firstCostField });
export type ServerCreate = z.infer<typeof serverCreateSchema>;

export const serverUpdateSchema = z.strictObject({
  ...serverPlaceInput,
  url: urlTextSchema.nullable().transform(emptyToNull),
  ...versionField,
});
export type ServerUpdate = z.infer<typeof serverUpdateSchema>;

const tariffFieldsInput = {
  programId: programIdSchema,
  serverId: serverIdSchema,
  name: referenceNameSchema,
  billingModel: z.enum(BILLING_MODEL_KEYS, { error: "Оберіть період" }),
  priceKop: amountKopSchema,
};

export const tariffCreateSchema = z.strictObject(tariffFieldsInput);
export type TariffCreate = z.infer<typeof tariffCreateSchema>;

export const tariffUpdateSchema = z.strictObject({ ...tariffFieldsInput, ...versionField });
export type TariffUpdate = z.infer<typeof tariffUpdateSchema>;

export const tariffVersionInputSchema = z.strictObject({ name: referenceNameSchema, priceKop: amountKopSchema });
export type TariffVersionInput = z.infer<typeof tariffVersionInputSchema>;

const addonFieldsInput = {
  name: referenceNameSchema,
  // A set in the end: a program named twice is one program, and addon_programs has one row for it
  programIds: z
    .array(programIdSchema, { error: PROGRAM_REQUIRED })
    .min(1, PROGRAM_REQUIRED)
    .max(REFERENCE_PAGE_MAX, LONG_VALUE)
    .transform((ids) => [...new Set(ids)]),
};

export const addonCreateSchema = z.strictObject({
  ...addonFieldsInput,
  price: datedPriceSchema,
  ...firstCostField,
});
export type AddonCreate = z.infer<typeof addonCreateSchema>;

export const addonUpdateSchema = z.strictObject({ ...addonFieldsInput, ...versionField });
export type AddonUpdate = z.infer<typeof addonUpdateSchema>;

export const simPlanCreateSchema = z.strictObject({
  ...simpleFieldsInput,
  operatorId: operatorIdSchema,
  ...firstCostField,
});
export type SimPlanCreate = z.infer<typeof simPlanCreateSchema>;

export const simPlanUpdateSchema = z.strictObject({
  ...simpleFieldsUpdate,
  operatorId: operatorIdSchema,
  ...versionField,
});
export type SimPlanUpdate = z.infer<typeof simPlanUpdateSchema>;

export const costPriceInputSchema = z.strictObject({
  subjectType: z.enum(COST_SUBJECT_TYPES),
  subjectId: z.uuid("Некоректний ідентифікатор"),
  amountKop: amountKopSchema,
  validFrom: businessDateSchema,
});
export type CostPriceInput = z.infer<typeof costPriceInputSchema>;

// From a history in date order: what is in force today, and what comes next. A date compares as text (dates.ts).
export function currentPrice(history: PriceEntry[], today: string): PriceEntry | null {
  return history.filter((entry) => entry.validFrom <= today).at(-1) ?? null;
}

export function nextPrice(history: PriceEntry[], today: string): PriceEntry | null {
  return history.find((entry) => entry.validFrom > today) ?? null;
}
