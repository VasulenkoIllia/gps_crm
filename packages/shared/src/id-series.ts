import { z } from "zod";
import { versionField } from "./references.ts";

const NAME_MAX_LENGTH = 100;
const LONG_VALUE = "Занадто довге значення";
const NAME_REQUIRED = "Вкажіть назву серії";
const NUMBER_TEXT = "Вкажіть номер від 10000";
const RANGE_TEXT = "Кінець діапазону раніше за початок";
// The smallest ID there can be: five digits (subscribers.md П23)
export const ID_SERIES_MIN = 10_000;
// A number goes through the API as a number
export const ID_SERIES_MAX = 999_999_999_999_999;

export const SUBSCRIBER_TYPE_KEYS = ["B2C", "B2B", "B2G"] as const;
export type SubscriberType = (typeof SUBSCRIBER_TYPE_KEYS)[number];

export const SUBSCRIBER_TYPES: Record<SubscriberType, string> = {
  B2C: "Фізична особа (B2C)",
  B2B: "Юрособа або ФОП (B2B)",
  B2G: "Держзамовник (B2G)",
};

export const seriesNumberSchema = z
  .number({ error: NUMBER_TEXT })
  .int(NUMBER_TEXT)
  .min(ID_SERIES_MIN, NUMBER_TEXT)
  .max(ID_SERIES_MAX, NUMBER_TEXT);

export const seriesNameSchema = z
  .string({ error: NAME_REQUIRED })
  .trim()
  .min(1, NAME_REQUIRED)
  .max(NAME_MAX_LENGTH, LONG_VALUE);

interface SeriesRange {
  rangeFrom: number;
  rangeTo: number;
  nextNumber: number;
}

export function nextNumberText({ rangeFrom, rangeTo }: Pick<SeriesRange, "rangeFrom" | "rangeTo">): string {
  return `Наступний номер має бути в межах від ${rangeFrom} до ${rangeTo}`;
}

// One past the end is a series used up: it may still be saved, say to rename it, and it issues nothing
const refineRange = (series: SeriesRange, context: z.RefinementCtx) => {
  if (series.rangeFrom > series.rangeTo) {
    context.addIssue({ code: "custom", path: ["rangeTo"], message: RANGE_TEXT });
    return;
  }
  if (series.nextNumber < series.rangeFrom || series.nextNumber > series.rangeTo + 1) {
    context.addIssue({ code: "custom", path: ["nextNumber"], message: nextNumberText(series) });
  }
};

const seriesFields = {
  name: seriesNameSchema,
  rangeFrom: seriesNumberSchema,
  rangeTo: seriesNumberSchema,
  nextNumber: seriesNumberSchema,
  // A set in the end. A type named here that sits in another series moves over (D62).
  types: z.array(z.enum(SUBSCRIBER_TYPE_KEYS)).transform((types) => [...new Set(types)]),
};

export const idSeriesCreateSchema = z.strictObject(seriesFields).superRefine(refineRange);
export type IdSeriesCreate = z.infer<typeof idSeriesCreateSchema>;

export const idSeriesUpdateSchema = z.strictObject({ ...seriesFields, ...versionField }).superRefine(refineRange);
export type IdSeriesUpdate = z.infer<typeof idSeriesUpdateSchema>;

const idSeriesSchema = z.strictObject({
  id: z.string(),
  version: z.number(),
  name: z.string(),
  rangeFrom: z.number(),
  rangeTo: z.number(),
  nextNumber: z.number(),
  types: z.array(z.enum(SUBSCRIBER_TYPE_KEYS)),
  numbersLeft: z.number(),
});
export type IdSeries = z.infer<typeof idSeriesSchema>;

export const idSeriesListSchema = z.strictObject({ items: z.array(idSeriesSchema) });
export type IdSeriesList = z.infer<typeof idSeriesListSchema>;
