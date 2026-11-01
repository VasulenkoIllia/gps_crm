import { z } from "zod";
import { blankToNull } from "./contacts.ts";
import { deviceChoiceSchema, pastDateSchema, sensorChoiceSchema, simChoiceSchema } from "./equipment.ts";
import { decodeListCursor, listCursorSchema } from "./list-cursor.ts";
import { isLivePeriod, periodOn, type DatedPeriod } from "./periods.ts";
import { emptyToNull, noteTextSchema, pageOf, versionField } from "./references.ts";
import { SORT_ORDERS, subscriberCountSchema, tariffValidFromSchema } from "./subscribers.ts";
import type { StatusMeta } from "./users.ts";

const NAME_MAX_LENGTH = 300;
const SEARCH_MAX_LENGTH = 100;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const ADDONS_MAX = 50;
const SENSORS_MAX = 20;
const NAME_TEXT = "Вкажіть назву об'єкта";
const CLIENT_TEXT = "Оберіть клієнта";
const PAYER_TEXT = "Оберіть платника цього клієнта";
const REASON_TEXT = "Вкажіть причину відключення";
const REASON_ONLY_TEXT = "Причина потрібна лише для відключення";
const INSTALLED_TEXT = "Вкажіть дату встановлення трекера";
const ADDON_TEXT = "Оберіть послугу";
const PROGRAM_TEXT = "Оберіть програму";
const TARIFF_TEXT = "Оберіть тариф";
const STATUS_TEXT = "Оберіть статус";
const STATUS_DATE_TEXT = "Статус не може діяти раніше дати підключення";
const INSTALLED_DATE_TEXT = "Дата встановлення раніше дати підключення";
const TERMS_TEXT = "Вкажіть, що змінюється";
const PAYER_DATE_TEXT = "Для платника оберіть сьогодні або минулу дату";
const SIM_CHOICE_TEXT = "Оберіть нову SIM або перенесіть стару";
const ADDON_TWICE_TEXT = "Ця послуга вже є в списку";
const INVALID_ID = "Некоректний ідентифікатор";

export const OBJECT_STATUS_META = {
  active: { label: "Активний", tone: "good" },
  suspended: { label: "Призупинений", tone: "warning" },
  disconnected: { label: "Відключений", tone: "neutral" },
} as const satisfies Record<string, StatusMeta>;
export type ObjectStatus = keyof typeof OBJECT_STATUS_META;
const OBJECT_STATUS_KEYS = Object.keys(OBJECT_STATUS_META) as ObjectStatus[];

// objects.md П6, П8: a disconnected object has one way back, through a new active period
const NEXT_STATUSES: Record<ObjectStatus, ObjectStatus[]> = {
  active: ["suspended", "disconnected"],
  suspended: ["active", "disconnected"],
  disconnected: ["active"],
};

export function nextObjectStatuses(status: ObjectStatus): ObjectStatus[] {
  return NEXT_STATUSES[status];
}

// What may stand in for a tracker going off an object: it comes back to work or goes to be fixed (П14)
export const OLD_DEVICE_STATES = { removed: "Знято", repair: "Ремонт" } as const;
export type OldDeviceState = keyof typeof OLD_DEVICE_STATES;
const OLD_DEVICE_STATE_KEYS = Object.keys(OLD_DEVICE_STATES) as OldDeviceState[];

export const objectNameSchema = z.string({ error: NAME_TEXT }).trim().min(1, NAME_TEXT).max(NAME_MAX_LENGTH, NAME_TEXT);

const optionalId = z.preprocess(blankToNull, z.uuid(INVALID_ID).nullable());
const installedOnSchema = z.iso.date({ error: INSTALLED_TEXT }).pipe(pastDateSchema);

const ownTariffFields = {
  programId: z.uuid(PROGRAM_TEXT),
  tariffId: z.uuid(TARIFF_TEXT),
};

const addonStartSchema = z.strictObject({ addonId: z.uuid(ADDON_TEXT), validFrom: pastDateSchema });

const sensorStartSchema = z.strictObject({ sensor: sensorChoiceSchema, installedOn: pastDateSchema });

// The database refuses it too, but as an overlap of periods nobody could read
function hasRepeatedAddon(addons: { addonId: string }[]): boolean {
  return new Set(addons.map(({ addonId }) => addonId)).size !== addons.length;
}

export const objectCreateSchema = z
  .strictObject({
    subscriberId: z.uuid(CLIENT_TEXT),
    name: objectNameSchema,
    status: z.enum(OBJECT_STATUS_KEYS, { error: STATUS_TEXT }),
    statusFrom: pastDateSchema,
    disconnectReasonId: optionalId.optional(),
    connectedOn: pastDateSchema,
    device: deviceChoiceSchema,
    installedOn: installedOnSchema,
    contractorId: optionalId.optional(),
    sim: simChoiceSchema,
    payerId: z.uuid(PAYER_TEXT),
    ownTariff: z.strictObject({ ...ownTariffFields, validFrom: tariffValidFromSchema }).optional(),
    addons: z.array(addonStartSchema).max(ADDONS_MAX).default([]),
    sensors: z.array(sensorStartSchema).max(SENSORS_MAX).default([]),
    note: noteTextSchema.nullish().transform(emptyToNull),
  })
  .superRefine((input, context) => {
    if (input.status === "disconnected" && !input.disconnectReasonId) {
      context.addIssue({ code: "custom", path: ["disconnectReasonId"], message: REASON_TEXT });
    }
    if (input.status !== "disconnected" && input.disconnectReasonId) {
      context.addIssue({ code: "custom", path: ["disconnectReasonId"], message: REASON_ONLY_TEXT });
    }
    if (input.statusFrom && input.statusFrom < input.connectedOn) {
      context.addIssue({ code: "custom", path: ["statusFrom"], message: STATUS_DATE_TEXT });
    }
    if (input.installedOn && input.installedOn < input.connectedOn) {
      context.addIssue({ code: "custom", path: ["installedOn"], message: INSTALLED_DATE_TEXT });
    }
    if (hasRepeatedAddon(input.addons)) {
      context.addIssue({ code: "custom", path: ["addons"], message: ADDON_TWICE_TEXT });
    }
  });
export type ObjectCreate = z.infer<typeof objectCreateSchema>;

// A change carries the whole record (D59); all the rest has an action of its own, with a date
export const objectUpdateSchema = z.strictObject({
  name: objectNameSchema,
  note: noteTextSchema.nullable().transform(emptyToNull),
  ...versionField,
});
export type ObjectUpdate = z.infer<typeof objectUpdateSchema>;

export const objectStatusChangeSchema = z
  .strictObject({
    status: z.enum(OBJECT_STATUS_KEYS, { error: STATUS_TEXT }),
    validFrom: pastDateSchema,
    reasonId: optionalId.optional(),
    note: noteTextSchema.nullish().transform(emptyToNull),
  })
  .superRefine((input, context) => {
    if (input.status === "disconnected" && !input.reasonId) {
      context.addIssue({ code: "custom", path: ["reasonId"], message: REASON_TEXT });
    }
    if (input.status !== "disconnected" && input.reasonId) {
      context.addIssue({ code: "custom", path: ["reasonId"], message: REASON_ONLY_TEXT });
    }
  });
export type ObjectStatusChange = z.infer<typeof objectStatusChangeSchema>;

// Only what changes: a payer and a tariff live on one version, and each has its own form. An empty own tariff brings the
// tariff of the client back.
export const objectTermsChangeSchema = z
  .strictObject({
    validFrom: tariffValidFromSchema,
    payerId: z.uuid(PAYER_TEXT).optional(),
    ownTariff: z.strictObject(ownTariffFields).nullable().optional(),
  })
  .superRefine((input, context) => {
    if (input.payerId === undefined && input.ownTariff === undefined) {
      context.addIssue({ code: "custom", path: ["validFrom"], message: TERMS_TEXT });
    }
    if (input.payerId !== undefined && !pastDateSchema.safeParse(input.validFrom).success) {
      context.addIssue({ code: "custom", path: ["validFrom"], message: PAYER_DATE_TEXT });
    }
  });
export type ObjectTermsChange = z.infer<typeof objectTermsChangeSchema>;

export const OBJECT_ADDON_ACTIONS = { connect: "Підключити", disconnect: "Відключити" } as const;
export type ObjectAddonAction = keyof typeof OBJECT_ADDON_ACTIONS;

export const objectAddonChangeSchema = z.strictObject({
  addonId: z.uuid(ADDON_TEXT),
  action: z.enum(Object.keys(OBJECT_ADDON_ACTIONS) as ObjectAddonAction[]),
  date: pastDateSchema,
});
export type ObjectAddonChange = z.infer<typeof objectAddonChangeSchema>;

export const replaceDeviceSchema = z
  .strictObject({
    device: deviceChoiceSchema,
    installedOn: installedOnSchema,
    contractorId: optionalId.optional(),
    oldState: z.enum(OLD_DEVICE_STATE_KEYS).default("removed"),
    moveSim: z.boolean(),
    sim: simChoiceSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.moveSim === Boolean(input.sim)) {
      context.addIssue({ code: "custom", path: ["sim"], message: SIM_CHOICE_TEXT });
    }
  });
export type ReplaceDevice = z.infer<typeof replaceDeviceSchema>;

export const replaceSimSchema = z.strictObject({
  sim: simChoiceSchema,
  installedOn: pastDateSchema,
  contractorId: optionalId.optional(),
});
export type ReplaceSim = z.infer<typeof replaceSimSchema>;

export const addSensorSchema = z.strictObject({
  sensor: sensorChoiceSchema,
  installedOn: pastDateSchema,
  contractorId: optionalId.optional(),
});
export type AddSensor = z.infer<typeof addSensorSchema>;

export const removeSensorSchema = z.strictObject({ removedOn: pastDateSchema });
export type RemoveSensor = z.infer<typeof removeSensorSchema>;

export const OBJECT_SORTS = ["name", "connectedOn", "createdAt", "subscriber"] as const;
export type ObjectSort = (typeof OBJECT_SORTS)[number];

const listFilters = {
  q: z.string().trim().min(1).max(SEARCH_MAX_LENGTH).optional(),
  status: z.enum(OBJECT_STATUS_KEYS).optional(),
  programId: z.uuid(INVALID_ID).optional(),
  serverId: z.uuid(INVALID_ID).optional(),
  tariffId: z.uuid(INVALID_ID).optional(),
  modelId: z.uuid(INVALID_ID).optional(),
  addonId: z.uuid(INVALID_ID).optional(),
  subscriberId: z.uuid(INVALID_ID).optional(),
  managerId: z.uuid(INVALID_ID).optional(),
  archived: z.literal("true").optional(),
};

// A cursor comes from the address: what its sort column cannot hold stops here and not in the database
const CURSOR_VALUES: Partial<Record<ObjectSort, z.ZodType>> = { connectedOn: pastDateSchema, subscriber: z.uuid() };

export const objectCountQuerySchema = z.strictObject(listFilters);
export type ObjectCountQuery = z.infer<typeof objectCountQuerySchema>;

export const objectListQuerySchema = z
  .strictObject({
    ...listFilters,
    cursor: listCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
    sort: z.enum(OBJECT_SORTS).default("createdAt"),
    order: z.enum(SORT_ORDERS).default("desc"),
  })
  .superRefine((query, context) => {
    const valueSchema = CURSOR_VALUES[query.sort];
    if (!query.cursor || !valueSchema) return;
    if (!valueSchema.safeParse(decodeListCursor(query.cursor).value).success) {
      context.addIssue({ code: "custom", path: ["cursor"], message: "Некоректний курсор" });
    }
  });
export type ObjectListQuery = z.infer<typeof objectListQuerySchema>;

const objectListItemSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  subscriberId: z.string(),
  subscriberCode: z.number(),
  subscriberName: z.string(),
  programName: z.string(),
  tariffName: z.string(),
  hasOwnTariff: z.boolean(),
  addonNames: z.array(z.string()),
  modelName: z.string().nullable(),
  imei: z.string().nullable(),
  status: z.enum(OBJECT_STATUS_KEYS),
  statusFrom: z.string(),
  connectedOn: z.string(),
  createdAt: z.string(),
  isArchived: z.boolean(),
});
export type ObjectListItem = z.infer<typeof objectListItemSchema>;

export const objectListSchema = pageOf(objectListItemSchema);
export type ObjectList = z.infer<typeof objectListSchema>;

const tariffFactSchema = z.strictObject({
  tariffId: z.string(),
  tariffName: z.string(),
  programId: z.string(),
  programName: z.string(),
  serverName: z.string(),
  isOwn: z.boolean(),
});
export type ObjectTariffFact = z.infer<typeof tariffFactSchema>;

const installedFields = { installedOn: z.string(), contractorName: z.string().nullable() };

export const objectCardSchema = z.strictObject({
  id: z.string(),
  version: z.number(),
  name: z.string(),
  subscriberId: z.string(),
  subscriberCode: z.number(),
  subscriberName: z.string(),
  status: z.enum(OBJECT_STATUS_KEYS),
  statusFrom: z.string(),
  connectedOn: z.string(),
  disconnectedOn: z.string().nullable(),
  disconnectReasonName: z.string().nullable(),
  // What holds today, whatever the date of a version planned on top of it (D70)
  tariff: tariffFactSchema,
  nextTariff: z.strictObject({ ...tariffFactSchema.shape, validFrom: z.string() }).nullable(),
  payerId: z.string(),
  payerName: z.string(),
  payerFrom: z.string(),
  addons: z.array(z.strictObject({ addonId: z.string(), addonName: z.string(), validFrom: z.string() })),
  device: z
    .strictObject({ id: z.string(), imei: z.string(), modelName: z.string().nullable(), ...installedFields })
    .nullable(),
  sim: z
    .strictObject({
      id: z.string(),
      iccid: z.string(),
      msisdn: z.string().nullable(),
      operatorName: z.string().nullable(),
      planName: z.string().nullable(),
      ...installedFields,
    })
    .nullable(),
  sensors: z.array(z.strictObject({ id: z.string(), serialNo: z.string(), ...installedFields })),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isArchived: z.boolean(),
});
export type ObjectCard = z.infer<typeof objectCardSchema>;

const periodFields = { id: z.string(), validFrom: z.string(), validTo: z.string().nullable() };
const installationFields = { ...periodFields, contractorName: z.string().nullable() };

export const objectHistorySchema = z.strictObject({
  statuses: z.array(
    z.strictObject({
      ...periodFields,
      status: z.enum(OBJECT_STATUS_KEYS),
      reasonName: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
  terms: z.array(z.strictObject({ ...periodFields, payerName: z.string(), ownTariffName: z.string().nullable() })),
  addons: z.array(z.strictObject({ ...periodFields, addonName: z.string() })),
  devices: z.array(z.strictObject({ ...installationFields, imei: z.string(), modelName: z.string().nullable() })),
  sims: z.array(z.strictObject({ ...installationFields, iccid: z.string(), imei: z.string() })),
  sensors: z.array(z.strictObject({ ...installationFields, serialNo: z.string() })),
});
export type ObjectHistory = z.infer<typeof objectHistorySchema>;

export const objectCountSchema = subscriberCountSchema;
export type ObjectCount = z.infer<typeof objectCountSchema>;

export const createdObjectSchema = z.strictObject({ id: z.string() });
export type CreatedObject = z.infer<typeof createdObjectSchema>;

export const objectSensorParamsSchema = z.strictObject({
  id: z.uuid(INVALID_ID),
  sensorId: z.uuid(INVALID_ID),
});

interface TermVersion extends Pick<DatedPeriod, "validFrom" | "validTo"> {
  ownTariffId: string | null;
}

interface ClientTariffVersion extends Pick<DatedPeriod, "validFrom" | "validTo"> {
  tariffId: string;
}

function earliest<T extends Pick<DatedPeriod, "validFrom" | "validTo">>(periods: T[]): T | null {
  const live = periods.filter(isLivePeriod);
  return live.reduce<T | null>(
    (first, period) => (!first || period.validFrom < first.validFrom ? period : first),
    null,
  );
}

// П18. A date before the first version falls to the first: a client created with a tariff from the next month has its
// objects working before that, and the same goes for an object.
export function objectTariffOn(
  date: string,
  terms: TermVersion[],
  clientPeriods: ClientTariffVersion[],
): { tariffId: string; isOwn: boolean } | null {
  const term = periodOn(terms, date) ?? earliest(terms);
  if (term?.ownTariffId) return { tariffId: term.ownTariffId, isOwn: true };
  const period = periodOn(clientPeriods, date) ?? earliest(clientPeriods);
  return period ? { tariffId: period.tariffId, isOwn: false } : null;
}
