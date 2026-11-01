import { z } from "zod";

const KOP_IN_UAH = 100;
const KOP_DIGITS = 2;
// 100 million hryvnias: far above any price here, and far inside a safe integer
export const MONEY_MAX_KOP = 10_000_000_000;
const PRICE_REQUIRED = "Вкажіть ціну більше нуля";

const MONEY_TEXT = /^\d{1,8}([.,]\d{1,2})?$/;
const WHOLE_FORMAT = new Intl.NumberFormat("uk-UA");

// Whole kopecks all the way (03-data-model.md §3.1): a fraction exists only as text on the screen
export function formatMoney(kop: number): string {
  const whole = Math.trunc(kop / KOP_IN_UAH);
  const rest = String(Math.abs(kop % KOP_IN_UAH)).padStart(KOP_DIGITS, "0");
  return `${WHOLE_FORMAT.format(whole)},${rest} грн`;
}

// What an edit form starts from: the same digits as on the screen, without the grouping a person would have to retype
export function moneyToText(kop: number): string {
  const rest = String(kop % KOP_IN_UAH).padStart(KOP_DIGITS, "0");
  return `${Math.trunc(kop / KOP_IN_UAH)},${rest}`;
}

// Text to kopecks without going through a fraction, which could not hold 0,07 exactly. Null for anything that is no sum.
export function parseMoneyToKop(text: string): number | null {
  const compact = text.replace(/\s/g, "");
  if (!MONEY_TEXT.test(compact)) return null;
  const [whole = "0", fraction = ""] = compact.split(/[.,]/);
  return Number(whole) * KOP_IN_UAH + Number(fraction.padEnd(KOP_DIGITS, "0"));
}

export const amountKopSchema = z
  .number({ error: PRICE_REQUIRED })
  .int(PRICE_REQUIRED)
  .positive(PRICE_REQUIRED)
  .max(MONEY_MAX_KOP, PRICE_REQUIRED);

// The field of a form: it holds text, and the kopecks go to the API
export const moneyTextSchema = z.string({ error: PRICE_REQUIRED }).refine((text) => {
  return amountKopSchema.safeParse(parseMoneyToKop(text)).success;
}, PRICE_REQUIRED);
