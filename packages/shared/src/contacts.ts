import { z } from "zod";
import { emailSchema } from "./auth.ts";
import { phoneSchema } from "./phone.ts";
import { emptyToNull, noteTextSchema, pageOf, versionField } from "./references.ts";

const NAME_MAX_LENGTH = 200;
const POSITION_MAX_LENGTH = 200;
const CHAT_ID_MAX_LENGTH = 100;
const URL_MAX_LENGTH = 500;
const LONG_VALUE = "Занадто довге значення";
const NAME_REQUIRED = "Вкажіть ПІБ";

export const CONTACT_CHANNELS = { telegram: "Telegram", viber: "Viber", email: "Email" } as const;
export type ContactChannel = keyof typeof CONTACT_CHANNELS;
const CONTACT_CHANNEL_KEYS = Object.keys(CONTACT_CHANNELS) as ContactChannel[];

export const CONTACT_STATUS_META = {
  active: { label: "Активна", tone: "good" },
  inactive: { label: "Неактивна", tone: "neutral" },
} as const;

export const CRM_URL_TEXT = "Вставте повне посилання з CRM, наприклад https://…";

export const crmUrlSchema = z
  .string({ error: CRM_URL_TEXT })
  .trim()
  .max(URL_MAX_LENGTH, LONG_VALUE)
  .regex(/^https?:\/\/\S+$/, CRM_URL_TEXT);

// A form holds "" for a field it left alone, and "" is no email, no phone and no chat id
export const blankToNull = (value: unknown) => (value === "" ? null : value);

export const contactNameSchema = z
  .string({ error: NAME_REQUIRED })
  .trim()
  .min(1, NAME_REQUIRED)
  .max(NAME_MAX_LENGTH, LONG_VALUE);

export const positionSchema = z.string().trim().max(POSITION_MAX_LENGTH, LONG_VALUE);
export const contactEmailSchema = z.preprocess(blankToNull, emailSchema.nullable());
export const secondPhoneSchema = z.preprocess(blankToNull, phoneSchema.nullable());
export const telegramChatIdSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .regex(/^-?\d{1,20}$/, "Telegram Chat ID складається з цифр")
    .nullable(),
);
export const viberChatIdSchema = z.preprocess(
  blankToNull,
  z.string().trim().max(CHAT_ID_MAX_LENGTH, LONG_VALUE).nullable(),
);
const channelSchema = z.enum(CONTACT_CHANNEL_KEYS, { error: "Оберіть канал повідомлень" });

interface ChannelFields {
  channel: ContactChannel;
  email?: string | null;
  telegramChatId?: string | null;
  viberChatId?: string | null;
}

const REQUIRED_BY_CHANNEL: Record<ContactChannel, { field: keyof ChannelFields; message: string }> = {
  telegram: { field: "telegramChatId", message: "Для каналу Telegram потрібен Chat ID з CRM" },
  viber: { field: "viberChatId", message: "Для каналу Viber потрібен Chat ID з CRM" },
  email: { field: "email", message: "Для каналу Email вкажіть адресу" },
};

// П4: what the chosen channel cannot go without
export function channelProblem(contact: ChannelFields): { field: string; message: string } | null {
  const required = REQUIRED_BY_CHANNEL[contact.channel];
  return contact[required.field] ? null : required;
}

const refineChannel = (contact: ChannelFields, context: z.RefinementCtx) => {
  const problem = channelProblem(contact);
  if (problem) context.addIssue({ code: "custom", path: [problem.field], message: problem.message });
};

const channelFields = {
  channel: channelSchema,
  email: contactEmailSchema.optional(),
  telegramChatId: telegramChatIdSchema.optional(),
  viberChatId: viberChatIdSchema.optional(),
};

// What the form of a new client asks about the first person (subscribers.md §5)
export const firstContactSchema = z
  .strictObject({
    fullName: contactNameSchema,
    position: positionSchema.nullish().transform(emptyToNull),
    phone: phoneSchema,
    ...channelFields,
  })
  .superRefine(refineChannel);
export type FirstContact = z.infer<typeof firstContactSchema>;

const contactFieldsInput = {
  fullName: contactNameSchema,
  position: positionSchema.nullish().transform(emptyToNull),
  phone: phoneSchema,
  phone2: secondPhoneSchema.optional(),
  crmUrl: crmUrlSchema,
  isPrimary: z.boolean().default(false),
  billingNotify: z.boolean().default(true),
  techNotify: z.boolean().default(true),
  isActive: z.boolean().default(true),
  note: noteTextSchema.nullish().transform(emptyToNull),
  ...channelFields,
};

export const contactCreateSchema = z.strictObject(contactFieldsInput).superRefine(refineChannel);
export type ContactCreate = z.infer<typeof contactCreateSchema>;

// A change carries the whole record (D59): a field left out is refused, a default would erase what it held
export const contactUpdateSchema = z
  .strictObject({
    fullName: contactNameSchema,
    position: positionSchema.nullable().transform(emptyToNull),
    phone: phoneSchema,
    phone2: secondPhoneSchema,
    crmUrl: crmUrlSchema,
    isPrimary: z.boolean(),
    billingNotify: z.boolean(),
    techNotify: z.boolean(),
    isActive: z.boolean(),
    note: noteTextSchema.nullable().transform(emptyToNull),
    channel: channelSchema,
    email: contactEmailSchema,
    telegramChatId: telegramChatIdSchema,
    viberChatId: viberChatIdSchema,
    ...versionField,
  })
  .superRefine(refineChannel);
export type ContactUpdate = z.infer<typeof contactUpdateSchema>;

const contactSchema = z.strictObject({
  id: z.string(),
  version: z.number(),
  subscriberId: z.string(),
  fullName: z.string(),
  position: z.string().nullable(),
  phone: z.string(),
  phone2: z.string().nullable(),
  email: z.string().nullable(),
  telegramChatId: z.string().nullable(),
  viberChatId: z.string().nullable(),
  // Empty only after the transfer of data (D36): the form asks for them
  channel: z.enum(CONTACT_CHANNEL_KEYS).nullable(),
  crmUrl: z.string().nullable(),
  isPrimary: z.boolean(),
  billingNotify: z.boolean(),
  techNotify: z.boolean(),
  isActive: z.boolean(),
  note: z.string().nullable(),
  isArchived: z.boolean(),
});
export type Contact = z.infer<typeof contactSchema>;

export const contactListSchema = pageOf(contactSchema);
export type ContactList = z.infer<typeof contactListSchema>;
