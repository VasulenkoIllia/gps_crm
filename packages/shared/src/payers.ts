import { z } from "zod";
import { blankToNull, positionSchema } from "./contacts.ts";
import { emailSchema } from "./auth.ts";
import { emptyToNull, noteTextSchema, pageOf, versionField } from "./references.ts";
import { normalizePhone } from "./phone.ts";
import { taxIdSchema } from "./tax-id.ts";

const NAME_MAX_LENGTH = 300;
const LEGAL_NAME_MAX_LENGTH = 500;
const CONTACT_MAX_LENGTH = 200;
const LONG_VALUE = "Занадто довге значення";
const NAME_REQUIRED = "Вкажіть назву або ПІБ платника";
const LEGAL_NAME_REQUIRED = "Вкажіть повну назву юрособи для рахунку";
const TAX_ID_REQUIRED = "Вкажіть ЄДРПОУ або ІПН";
const VCHASNO_EMAIL_REQUIRED = "Вкажіть пошту для відправки у «Вчасно»";
const DETAILS_CONTACT_REQUIRED = "Вкажіть телефон або пошту, куди надсилати реквізити";
const PAGE_DEFAULT = 20;
const PAGE_MAX = 100;
const SEARCH_MAX_LENGTH = 100;

export const PAYMENT_METHODS = { invoice: "Рахунок", vchasno: "Рахунок у «Вчасно»", iban: "IBAN-реквізити" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
const PAYMENT_METHOD_KEYS = Object.keys(PAYMENT_METHODS) as PaymentMethod[];

export const paymentMethodSchema = z.enum(PAYMENT_METHOD_KEYS, { error: "Оберіть форму оплати" });

// A phone or an email, kept in the form a search would compare with
function normalizeDetailsContact(text: string): string | null {
  const phone = normalizePhone(text);
  if (phone) return phone;
  const email = emailSchema.safeParse(text);
  return email.success ? email.data : null;
}

export const payerNameSchema = z
  .string({ error: NAME_REQUIRED })
  .trim()
  .min(1, NAME_REQUIRED)
  .max(NAME_MAX_LENGTH, LONG_VALUE);
export const legalNameSchema = z.preprocess(
  blankToNull,
  z.string().trim().max(LEGAL_NAME_MAX_LENGTH, LONG_VALUE).nullable(),
);
export const payerTaxIdSchema = z.preprocess(blankToNull, taxIdSchema.nullable());
export const vchasnoEmailSchema = z.preprocess(blankToNull, emailSchema.nullable());
export const detailsContactSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(CONTACT_MAX_LENGTH, LONG_VALUE)
    .refine((text) => normalizeDetailsContact(text) !== null, DETAILS_CONTACT_REQUIRED)
    .transform((text) => normalizeDetailsContact(text) ?? text)
    .nullable(),
);
export const paymentTermsSchema = positionSchema;

export interface PaymentFields {
  paymentMethod: PaymentMethod;
  legalName?: string | null;
  taxId?: string | null;
  vchasnoEmail?: string | null;
  detailsContact?: string | null;
}

const BILL_FIELDS = [
  { field: "legalName", message: LEGAL_NAME_REQUIRED },
  { field: "taxId", message: TAX_ID_REQUIRED },
] as const;

const REQUIRED_BY_METHOD: Record<PaymentMethod, readonly { field: keyof PaymentFields; message: string }[]> = {
  invoice: BILL_FIELDS,
  vchasno: [...BILL_FIELDS, { field: "vchasnoEmail", message: VCHASNO_EMAIL_REQUIRED }],
  iban: [{ field: "detailsContact", message: DETAILS_CONTACT_REQUIRED }],
};

// П8: what the form of payment cannot go without
export function paymentProblems(payer: PaymentFields): { field: string; message: string }[] {
  return REQUIRED_BY_METHOD[payer.paymentMethod].filter(({ field }) => !payer[field]);
}

const refinePayment = (payer: PaymentFields, context: z.RefinementCtx) => {
  for (const { field, message } of paymentProblems(payer)) {
    context.addIssue({ code: "custom", path: [field], message });
  }
};

// What the first payer of a new client takes beyond the client's own name and tax number (payers.md П2)
export const firstPayerFields = {
  paymentMethod: paymentMethodSchema,
  legalName: legalNameSchema.optional(),
  vchasnoEmail: vchasnoEmailSchema.optional(),
  detailsContact: detailsContactSchema.optional(),
  paymentTermsNote: paymentTermsSchema.nullish().transform(emptyToNull),
};

export const firstPayerSchema = z.strictObject(firstPayerFields);
export type FirstPayer = z.infer<typeof firstPayerSchema>;

export const payerCreateSchema = z
  .strictObject({
    ...firstPayerFields,
    name: payerNameSchema,
    taxId: payerTaxIdSchema.optional(),
    note: noteTextSchema.nullish().transform(emptyToNull),
  })
  .superRefine(refinePayment);
export type PayerCreate = z.infer<typeof payerCreateSchema>;

export const payerUpdateSchema = z
  .strictObject({
    name: payerNameSchema,
    paymentMethod: paymentMethodSchema,
    legalName: legalNameSchema,
    taxId: payerTaxIdSchema,
    vchasnoEmail: vchasnoEmailSchema,
    detailsContact: detailsContactSchema,
    paymentTermsNote: paymentTermsSchema.nullable().transform(emptyToNull),
    note: noteTextSchema.nullable().transform(emptyToNull),
    ...versionField,
  })
  .superRefine(refinePayment);
export type PayerUpdate = z.infer<typeof payerUpdateSchema>;

const payerClientSchema = z.strictObject({ id: z.string(), name: z.string(), code: z.number() });

const payerSchema = z.strictObject({
  id: z.string(),
  version: z.number(),
  name: z.string(),
  paymentMethod: z.enum(PAYMENT_METHOD_KEYS),
  legalName: z.string().nullable(),
  taxId: z.string().nullable(),
  vchasnoEmail: z.string().nullable(),
  detailsContact: z.string().nullable(),
  paymentTermsNote: z.string().nullable(),
  note: z.string().nullable(),
  isArchived: z.boolean(),
  // Who else this payer pays for, the client of the card left out where there is one (payers.md §5)
  otherClients: z.array(payerClientSchema),
  // Each client of the payer has its own objects under it: with objects, step 5
  objectCount: z.number(),
  contractNumbers: z.array(z.string()),
});
export type Payer = z.infer<typeof payerSchema>;

export const payerListSchema = pageOf(payerSchema);
export type PayerList = z.infer<typeof payerListSchema>;

export const payerSearchQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(SEARCH_MAX_LENGTH).optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});
export type PayerSearchQuery = z.infer<typeof payerSearchQuerySchema>;

export const payerLinkParamsSchema = z.strictObject({
  id: z.uuid("Некоректний ідентифікатор"),
  payerId: z.uuid("Некоректний ідентифікатор"),
});
