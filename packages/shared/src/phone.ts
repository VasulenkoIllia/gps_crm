import { z } from "zod";

const PHONE_TEXT = "Введіть номер у форматі +380 XX XXX XX XX";
const UKRAINE_PHONE = /^\+380\d{9}$/;
const SEPARATORS = /[\s()-]/g;
// What people type before the operator code: +380, 380 or the local 0
const COUNTRY_PREFIXES = [
  [/^\+380/, "+380"],
  [/^380/, "+380"],
  [/^0/, "+380"],
] as const;
// +380 67 123 45 67
const PHONE_PARTS = /^(\+380)(\d{2})(\d{3})(\d{2})(\d{2})$/;

// E.164 (contacts.md П5), or null for what is no Ukrainian number
export function normalizePhone(text: string): string | null {
  const compact = text.replace(SEPARATORS, "");
  const prefix = COUNTRY_PREFIXES.find(([pattern]) => pattern.test(compact));
  const phone = prefix ? compact.replace(prefix[0], prefix[1]) : compact;
  return UKRAINE_PHONE.test(phone) ? phone : null;
}

export function formatPhone(phone: string): string {
  const parts = PHONE_PARTS.exec(phone);
  return parts ? parts.slice(1).join(" ") : phone;
}

// `*_rev` columns (03-data-model.md §3.1): an index finds a number by how it ends only through the digits read backwards
export function reverseDigits(value: string): string {
  return [...value.replace(/\D/g, "")].reverse().join("");
}

export const phoneSchema = z
  .string({ error: PHONE_TEXT })
  .refine((text) => normalizePhone(text) !== null, PHONE_TEXT)
  .transform((text) => normalizePhone(text) ?? text);
