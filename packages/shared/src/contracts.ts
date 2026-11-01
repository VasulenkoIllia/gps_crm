import { z } from "zod";
import { addDays, businessDateSchema } from "./dates.ts";
import { decodeListCursor, listCursorSchema } from "./list-cursor.ts";
import { blankToNull } from "./contacts.ts";
import { emptyToNull, noteTextSchema, pageOf, versionField } from "./references.ts";
import type { StatusMeta } from "./users.ts";

const NUMBER_MAX_LENGTH = 100;
const LONG_VALUE = "Занадто довге значення";
const NUMBER_REQUIRED = "Вкажіть номер договору";
const VALID_UNTIL_REQUIRED = "Вкажіть, до якої дати діє договір";
const SIGNED_ON_REQUIRED = "Вкажіть дату підписання";
const ENDS_BEFORE_SIGNING = "Дата закінчення раніше дати підписання";
const TERMINATED_BEFORE_SIGNING = "Дата розірвання раніше дати підписання";
const PAYER_REQUIRED = "Оберіть платника";
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const SEARCH_MAX_LENGTH = 100;

export const CONTRACT_EXPIRY_DAYS = 30;
// 06-quality.md §6.2.2
export const CONTRACT_FILE_MAX_BYTES = 20 * 1024 * 1024;
export const CONTRACT_FILE_TEXT = "Завантажте PDF або зображення до 20 МБ";

export const CONTRACT_STATUSES = ["pending", "active", "expired", "terminated"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_META: Record<ContractStatus, StatusMeta> = {
  pending: { label: "Очікує підписання", tone: "pending" },
  active: { label: "Діючий", tone: "good" },
  expired: { label: "Закінчився", tone: "neutral" },
  terminated: { label: "Розірваний", tone: "critical" },
};

export const CONTRACT_EXPIRING_META: StatusMeta = { label: "Спливає", tone: "warning" };

export interface ContractDates {
  signedOn: string;
  validUntil: string;
  terminatedOn: string | null;
}

// Nothing of this is stored: today moves, and a stored status would have to be walked every night (contracts.md П2а)
export function contractStatus(dates: ContractDates, today: string): ContractStatus {
  if (dates.terminatedOn) return "terminated";
  if (dates.signedOn > today) return "pending";
  return dates.validUntil < today ? "expired" : "active";
}

// «Менше 30 днів до кінця»
export function isContractExpiring(dates: ContractDates, today: string): boolean {
  return contractStatus(dates, today) === "active" && dates.validUntil < addDays(today, CONTRACT_EXPIRY_DAYS);
}

export const contractNumberSchema = z
  .string({ error: NUMBER_REQUIRED })
  .trim()
  .min(1, NUMBER_REQUIRED)
  .max(NUMBER_MAX_LENGTH, LONG_VALUE);

export const signedOnSchema = z.string({ error: SIGNED_ON_REQUIRED }).pipe(businessDateSchema);
export const validUntilSchema = z.string({ error: VALID_UNTIL_REQUIRED }).pipe(businessDateSchema);
const terminatedOnSchema = z.preprocess(blankToNull, businessDateSchema.nullable());
const payerIdSchema = z.uuid(PAYER_REQUIRED);

interface SigningDates {
  signedOn: string;
  validUntil: string;
  terminatedOn?: string | null;
}

const refineDates = (contract: SigningDates, context: z.RefinementCtx) => {
  if (contract.validUntil < contract.signedOn) {
    context.addIssue({ code: "custom", path: ["validUntil"], message: ENDS_BEFORE_SIGNING });
  }
  if (contract.terminatedOn && contract.terminatedOn < contract.signedOn) {
    context.addIssue({ code: "custom", path: ["terminatedOn"], message: TERMINATED_BEFORE_SIGNING });
  }
};

export const contractCreateSchema = z
  .strictObject({
    payerId: payerIdSchema,
    number: contractNumberSchema,
    signedOn: signedOnSchema,
    validUntil: validUntilSchema,
    terminatedOn: terminatedOnSchema.optional(),
    note: noteTextSchema.nullish().transform(emptyToNull),
  })
  .superRefine(refineDates);
export type ContractCreate = z.infer<typeof contractCreateSchema>;

export const contractUpdateSchema = z
  .strictObject({
    payerId: payerIdSchema,
    number: contractNumberSchema,
    signedOn: signedOnSchema,
    validUntil: validUntilSchema,
    terminatedOn: terminatedOnSchema,
    note: noteTextSchema.nullable().transform(emptyToNull),
    ...versionField,
  })
  .superRefine(refineDates);
export type ContractUpdate = z.infer<typeof contractUpdateSchema>;

const contractClientSchema = z.strictObject({ id: z.string(), name: z.string(), code: z.number() });
const contractPayerSchema = z.strictObject({ id: z.string(), name: z.string(), taxId: z.string().nullable() });

const contractSchema = z.strictObject({
  id: z.string(),
  version: z.number(),
  number: z.string(),
  subscriber: contractClientSchema,
  payer: contractPayerSchema,
  signedOn: z.string(),
  validUntil: z.string(),
  terminatedOn: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(CONTRACT_STATUSES),
  isExpiring: z.boolean(),
  fileName: z.string().nullable(),
  isArchived: z.boolean(),
});
export type Contract = z.infer<typeof contractSchema>;

export const contractListSchema = pageOf(contractSchema);
export type ContractList = z.infer<typeof contractListSchema>;

export const contractListQuerySchema = z
  .strictObject({
    cursor: listCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
    q: z.string().trim().min(1).max(SEARCH_MAX_LENGTH).optional(),
    status: z.enum(CONTRACT_STATUSES).optional(),
    expiring: z.literal("true").optional(),
    signedFrom: businessDateSchema.optional(),
    signedTo: businessDateSchema.optional(),
    subscriberId: z.uuid("Некоректний ідентифікатор").optional(),
  })
  .superRefine((query, context) => {
    if (!query.cursor || businessDateSchema.safeParse(decodeListCursor(query.cursor).value).success) return;
    context.addIssue({ code: "custom", path: ["cursor"], message: "Некоректний курсор" });
  });
export type ContractListQuery = z.infer<typeof contractListQuerySchema>;

export const contractNumberCheckQuerySchema = z.strictObject({
  number: contractNumberSchema,
  payerId: payerIdSchema,
  excludeId: z.uuid().optional(),
});
export type ContractNumberCheckQuery = z.infer<typeof contractNumberCheckQuerySchema>;

const numberHolderSchema = z.strictObject({ id: z.string(), subscriberId: z.string(), payerName: z.string() });

export const contractNumberCheckSchema = z.strictObject({
  // The same payer: the database refuses it. Another payer: a warning with a link (П7).
  samePayer: numberHolderSchema.nullable(),
  otherPayer: numberHolderSchema.nullable(),
});
export type ContractNumberCheck = z.infer<typeof contractNumberCheckSchema>;

export const FILE_DISPOSITIONS = ["inline", "attachment"] as const;

export const contractFileQuerySchema = z.strictObject({
  disposition: z.enum(FILE_DISPOSITIONS).default("attachment"),
});
