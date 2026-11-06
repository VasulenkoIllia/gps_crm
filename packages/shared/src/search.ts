import { z } from "zod";
import { normalizeName } from "./normalize.ts";

const SEARCH_MAX_LENGTH = 100;
// search-exports.md П3
export const SEARCH_GROUP_SIZE = 5;
// П1: the last 4-6 digits of an IMEI or a phone are what a person reads off a tracker or a call
export const SEARCH_MIN_DIGITS = 4;
// П2
export const SEARCH_MIN_NAME = 3;
const PHONE_LIKE = /^[\d\s()+-]+$/;

// П1: a query of digits looks among the numbers, anything else among the names. The signs of a phone written by hand
// do not make it text.
export function isNumberQuery(text: string): boolean {
  return PHONE_LIKE.test(text) && /\d/.test(text);
}

// A query too short finds nothing on purpose (П1, П2), and the screen says why instead of «nothing found»
export function searchTooShortText(query: string | undefined): string | null {
  // Measured as the server measures it: spaces in a row count once
  const text = normalizeName(query ?? "");
  if (!text) return null;
  if (isNumberQuery(text)) {
    return text.replace(/\D/g, "").length < SEARCH_MIN_DIGITS ? `Введіть щонайменше ${SEARCH_MIN_DIGITS} цифри` : null;
  }
  return text.length < SEARCH_MIN_NAME ? `Введіть щонайменше ${SEARCH_MIN_NAME} символи` : null;
}

export const searchQuerySchema = z.strictObject({
  q: z.string().trim().min(1, "Введіть, що шукати").max(SEARCH_MAX_LENGTH),
  // П4
  archived: z.literal("true").optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

const archivedField = { isArchived: z.boolean() };

const clientHitSchema = z.strictObject({
  id: z.string(),
  code: z.number(),
  legacyCode: z.string().nullable(),
  name: z.string(),
  taxId: z.string().nullable(),
  ...archivedField,
});
export type ClientHit = z.infer<typeof clientHitSchema>;

const contactHitSchema = z.strictObject({
  id: z.string(),
  fullName: z.string(),
  phone: z.string(),
  subscriberId: z.string(),
  subscriberCode: z.number(),
  subscriberName: z.string(),
  ...archivedField,
});
export type ContactHit = z.infer<typeof contactHitSchema>;

const objectHitSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  imei: z.string().nullable(),
  subscriberCode: z.number(),
  subscriberName: z.string(),
  ...archivedField,
});
export type ObjectHit = z.infer<typeof objectHitSchema>;

const deviceHitSchema = z.strictObject({
  id: z.string(),
  imei: z.string(),
  modelName: z.string().nullable(),
  objectId: z.string().nullable(),
  objectName: z.string().nullable(),
  ...archivedField,
});
export type DeviceHit = z.infer<typeof deviceHitSchema>;

const simHitSchema = z.strictObject({
  id: z.string(),
  iccid: z.string(),
  msisdn: z.string().nullable(),
  deviceImei: z.string().nullable(),
  objectId: z.string().nullable(),
  objectName: z.string().nullable(),
  ...archivedField,
});
export type SimHit = z.infer<typeof simHitSchema>;

// hasMore: the group had more than it shows, and the list behind the link has the rest
function groupOf<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), hasMore: z.boolean() }).nullable();
}

// A group is null where it was not searched: the person may not see that kind, or a text does not reach the numbers
export const searchResultSchema = z.strictObject({
  clients: groupOf(clientHitSchema),
  contacts: groupOf(contactHitSchema),
  objects: groupOf(objectHitSchema),
  devices: groupOf(deviceHitSchema),
  sims: groupOf(simHitSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchGroup<T> = { items: T[]; hasMore: boolean } | null;
