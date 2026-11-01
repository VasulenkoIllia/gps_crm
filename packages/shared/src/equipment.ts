import { z } from "zod";
import { emptyToNull, noteTextSchema, pageOf, versionField } from "./references.ts";
import { blankToNull } from "./contacts.ts";
import { businessDateSchema, todayKyiv } from "./dates.ts";
import { phoneSchema } from "./phone.ts";
import type { StatusMeta } from "./users.ts";

const IMEI_TEXT = "IMEI складається з 15 цифр";
const ICCID_TEXT = "ICCID складається з 19-20 цифр";
const SERIAL_TEXT = "Вкажіть серійний номер";
const SERIAL_MAX_LENGTH = 100;
const SEARCH_MAX_LENGTH = 100;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const INVALID_ID = "Некоректний ідентифікатор";
const CHOICE_TEXT = "Оберіть зі списку або введіть новий";
const FUTURE_DATE = "Дата не може бути пізнішою за сьогодні";
const SEPARATORS = /[\s-]/g;
const IMEI_DIGITS = /^\d{15}$/;
const ICCID_DIGITS = /^\d{19,20}$/;
const LUHN_BASE = 10;
const LUHN_DOUBLED_MAX = 9;

export const DEVICE_STATUS_META = {
  installed: { label: "Встановлено", tone: "good" },
  removed: { label: "Знято", tone: "neutral" },
  repair: { label: "Ремонт", tone: "warning" },
  written_off: { label: "Списано", tone: "critical" },
} as const satisfies Record<string, StatusMeta>;
export type DeviceStatus = keyof typeof DEVICE_STATUS_META;
const DEVICE_STATUS_KEYS = Object.keys(DEVICE_STATUS_META) as DeviceStatus[];

export const SIM_STATUS_META = {
  active: { label: "Активна", tone: "good" },
  blocked: { label: "Заблокована", tone: "critical" },
  free: { label: "Вільна", tone: "neutral" },
} as const satisfies Record<string, StatusMeta>;
export type SimStatus = keyof typeof SIM_STATUS_META;
const SIM_STATUS_KEYS = Object.keys(SIM_STATUS_META) as SimStatus[];

export const DEVICE_OWNERSHIPS = { sold: "Продано клієнту", rented: "Оренда" } as const;
export type DeviceOwnership = keyof typeof DEVICE_OWNERSHIPS;
const OWNERSHIP_KEYS = Object.keys(DEVICE_OWNERSHIPS) as DeviceOwnership[];

// equipment.md §11: a number is read off a sticker, with whatever spaces and dashes it has there
export function normalizeNumber(text: string): string {
  return text.replace(SEPARATORS, "");
}

// A warning and never a refusal: some trackers carry a check digit of their own (equipment.md П1)
export function isImeiChecksumValid(imei: string): boolean {
  const digits = [...imei].reverse().map(Number);
  const sum = digits.reduce((total, digit, index) => {
    if (index % 2 === 0) return total + digit;
    const doubled = digit * 2;
    return total + (doubled > LUHN_DOUBLED_MAX ? doubled - LUHN_DOUBLED_MAX : doubled);
  }, 0);
  return sum % LUHN_BASE === 0;
}

export const imeiSchema = z
  .string({ error: IMEI_TEXT })
  .transform(normalizeNumber)
  .pipe(z.string().regex(IMEI_DIGITS, IMEI_TEXT));
export const iccidSchema = z
  .string({ error: ICCID_TEXT })
  .transform(normalizeNumber)
  .pipe(z.string().regex(ICCID_DIGITS, ICCID_TEXT));
export const msisdnSchema = z.preprocess(blankToNull, phoneSchema.nullable());
export const serialNoSchema = z
  .string({ error: SERIAL_TEXT })
  .trim()
  .min(1, SERIAL_TEXT)
  .max(SERIAL_MAX_LENGTH, "Занадто довге значення");

const optionalReferenceId = z.preprocess(blankToNull, z.uuid(INVALID_ID).nullable());

// Stage 1 takes no date ahead: planned changes come with stage 2 (03-data-model.md §3.4)
export const pastDateSchema = businessDateSchema.refine((date) => date <= todayKyiv(), FUTURE_DATE);

export const deviceFields = {
  imei: imeiSchema,
  modelId: optionalReferenceId,
  ownership: z.preprocess(blankToNull, z.enum(OWNERSHIP_KEYS).nullable()),
};

export const simFields = {
  iccid: iccidSchema,
  msisdn: msisdnSchema,
  operatorId: optionalReferenceId,
  planId: optionalReferenceId,
};

const refinePlan = (sim: { operatorId?: string | null; planId?: string | null }, context: z.RefinementCtx) => {
  if (sim.planId && !sim.operatorId) {
    context.addIssue({ code: "custom", path: ["operatorId"], message: "Оберіть оператора цього тарифу" });
  }
};

export const deviceCreateSchema = z.strictObject({
  imei: deviceFields.imei,
  modelId: deviceFields.modelId.optional(),
  ownership: deviceFields.ownership.optional(),
  note: noteTextSchema.nullish().transform(emptyToNull),
});
export type DeviceCreate = z.infer<typeof deviceCreateSchema>;

// A change carries the whole record (D59)
export const deviceUpdateSchema = z.strictObject({
  ...deviceFields,
  status: z.enum(DEVICE_STATUS_KEYS, { error: "Оберіть стан" }),
  note: noteTextSchema.nullable().transform(emptyToNull),
  ...versionField,
});
export type DeviceUpdate = z.infer<typeof deviceUpdateSchema>;

export const simCreateSchema = z
  .strictObject({
    iccid: simFields.iccid,
    msisdn: simFields.msisdn.optional(),
    operatorId: simFields.operatorId.optional(),
    planId: simFields.planId.optional(),
    note: noteTextSchema.nullish().transform(emptyToNull),
  })
  .superRefine(refinePlan);
export type SimCreate = z.infer<typeof simCreateSchema>;

export const simUpdateSchema = z
  .strictObject({
    ...simFields,
    status: z.enum(SIM_STATUS_KEYS, { error: "Оберіть стан" }),
    note: noteTextSchema.nullable().transform(emptyToNull),
    ...versionField,
  })
  .superRefine(refinePlan);
export type SimUpdate = z.infer<typeof simUpdateSchema>;

export const sensorCreateSchema = z.strictObject({
  serialNo: serialNoSchema,
  note: noteTextSchema.nullish().transform(emptyToNull),
});
export type SensorCreate = z.infer<typeof sensorCreateSchema>;

export const sensorUpdateSchema = z.strictObject({
  serialNo: serialNoSchema,
  note: noteTextSchema.nullable().transform(emptyToNull),
  ...versionField,
});
export type SensorUpdate = z.infer<typeof sensorUpdateSchema>;

const refineChoice =
  (idField: string, numberField: string) => (choice: Record<string, unknown>, context: z.RefinementCtx) => {
    if (Boolean(choice[idField]) === Boolean(choice[numberField])) {
      context.addIssue({ code: "custom", path: [idField], message: CHOICE_TEXT });
    }
  };

// In a form of an object: a free one from the list, or a new one typed in on the spot (objects.md П1)
export const deviceChoiceSchema = z
  .strictObject({
    deviceId: z.uuid(INVALID_ID).optional(),
    imei: deviceFields.imei.optional(),
    modelId: deviceFields.modelId.optional(),
  })
  .superRefine(refineChoice("deviceId", "imei"));
export type DeviceChoice = z.infer<typeof deviceChoiceSchema>;

export const simChoiceSchema = z
  .strictObject({
    simId: z.uuid(INVALID_ID).optional(),
    iccid: simFields.iccid.optional(),
    msisdn: simFields.msisdn.optional(),
    operatorId: simFields.operatorId.optional(),
    planId: simFields.planId.optional(),
  })
  .superRefine(refineChoice("simId", "iccid"))
  .superRefine(refinePlan);
export type SimChoice = z.infer<typeof simChoiceSchema>;

export const sensorChoiceSchema = z
  .strictObject({ sensorId: z.uuid(INVALID_ID).optional(), serialNo: serialNoSchema.optional() })
  .superRefine(refineChoice("sensorId", "serialNo"));
export type SensorChoice = z.infer<typeof sensorChoiceSchema>;

const searchField = z.string().trim().min(1).max(SEARCH_MAX_LENGTH).optional();
const pageFields = {
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
};
const idFilter = z.uuid(INVALID_ID).optional();
const archivedFilter = z.literal("true").optional();

export const deviceListQuerySchema = z.strictObject({
  q: searchField,
  status: z.enum(DEVICE_STATUS_KEYS).optional(),
  modelId: idFilter,
  contractorId: idFilter,
  archived: archivedFilter,
  ...pageFields,
});
export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;

export const simListQuerySchema = z.strictObject({
  q: searchField,
  status: z.enum(SIM_STATUS_KEYS).optional(),
  operatorId: idFilter,
  contractorId: idFilter,
  archived: archivedFilter,
  ...pageFields,
});
export type SimListQuery = z.infer<typeof simListQuerySchema>;

export const sensorListQuerySchema = z.strictObject({
  q: searchField,
  contractorId: idFilter,
  archived: archivedFilter,
  ...pageFields,
});
export type SensorListQuery = z.infer<typeof sensorListQuerySchema>;

export const availableQuerySchema = z.strictObject({ q: searchField, ...pageFields });
export type AvailableQuery = z.infer<typeof availableQuerySchema>;

export const equipmentCheckQuerySchema = z.strictObject({
  value: z.string().max(SEARCH_MAX_LENGTH),
  excludeId: z.uuid().optional(),
});

const placeSchema = z.strictObject({
  objectId: z.string(),
  objectName: z.string(),
  subscriberId: z.string(),
  subscriberName: z.string(),
  subscriberCode: z.number(),
  installedOn: z.string(),
  contractorName: z.string().nullable(),
});
export type EquipmentPlace = z.infer<typeof placeSchema>;

const rowFields = { id: z.string(), version: z.number(), note: z.string().nullable(), isArchived: z.boolean() };

const deviceRowSchema = z.strictObject({
  ...rowFields,
  imei: z.string(),
  modelId: z.string().nullable(),
  modelName: z.string().nullable(),
  ownership: z.enum(OWNERSHIP_KEYS).nullable(),
  status: z.enum(DEVICE_STATUS_KEYS),
  place: placeSchema.nullable(),
});
export type DeviceRow = z.infer<typeof deviceRowSchema>;
export const deviceListSchema = pageOf(deviceRowSchema);
export type DeviceList = z.infer<typeof deviceListSchema>;

const simRowSchema = z.strictObject({
  ...rowFields,
  iccid: z.string(),
  msisdn: z.string().nullable(),
  operatorId: z.string().nullable(),
  operatorName: z.string().nullable(),
  planId: z.string().nullable(),
  planName: z.string().nullable(),
  status: z.enum(SIM_STATUS_KEYS),
  deviceImei: z.string().nullable(),
  place: placeSchema.nullable(),
});
export type SimRow = z.infer<typeof simRowSchema>;
export const simListSchema = pageOf(simRowSchema);
export type SimList = z.infer<typeof simListSchema>;

const sensorRowSchema = z.strictObject({ ...rowFields, serialNo: z.string(), place: placeSchema.nullable() });
export type SensorRow = z.infer<typeof sensorRowSchema>;
export const sensorListSchema = pageOf(sensorRowSchema);
export type SensorList = z.infer<typeof sensorListSchema>;

const installationSchema = z.strictObject({
  id: z.string(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  contractorName: z.string().nullable(),
  // A tracker in the card of a SIM, an object in the card of a tracker
  label: z.string(),
  objectId: z.string().nullable(),
});
export type Installation = z.infer<typeof installationSchema>;

export const deviceCardSchema = z.strictObject({ ...deviceRowSchema.shape, history: z.array(installationSchema) });
export type DeviceCard = z.infer<typeof deviceCardSchema>;

export const simCardSchema = z.strictObject({
  ...simRowSchema.shape,
  // The price of the plan on this day, from the list of plans: not typed on a SIM (equipment.md П10). Null without `cost.read`
  planCostKop: z.number().nullable(),
  history: z.array(installationSchema),
});
export type SimCard = z.infer<typeof simCardSchema>;

export const equipmentCheckSchema = z.strictObject({
  isValid: z.boolean(),
  isFree: z.boolean(),
  // Only for an IMEI: a tracker with a check digit of its own is still a tracker
  hasChecksumWarning: z.boolean(),
  holder: z
    .strictObject({ id: z.string(), isArchived: z.boolean(), objectId: z.string().nullable(), label: z.string() })
    .nullable(),
});
export type EquipmentCheck = z.infer<typeof equipmentCheckSchema>;

export const createdEquipmentSchema = z.strictObject({ id: z.string() });
