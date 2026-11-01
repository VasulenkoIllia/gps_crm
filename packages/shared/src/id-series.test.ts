import { describe, expect, it } from "vitest";
import { idSeriesCreateSchema, SUBSCRIBER_TYPE_KEYS, SUBSCRIBER_TYPES } from "./id-series.ts";

const form = (fields: object = {}) => ({
  name: "Серія",
  rangeFrom: 10_000,
  rangeTo: 19_999,
  nextNumber: 10_000,
  types: ["B2C"],
  ...fields,
});
const problemOf = (fields: object) => idSeriesCreateSchema.safeParse(form(fields)).error?.issues[0]?.message;

describe("a series of ID", () => {
  it("has a label for every type", () => {
    for (const type of SUBSCRIBER_TYPE_KEYS) expect(SUBSCRIBER_TYPES[type]).toBeTruthy();
  });

  it("starts at five digits", () => {
    expect(problemOf({ rangeFrom: 9_999 })).toBe("Вкажіть номер від 10000");
  });

  it("does not run backwards", () => {
    expect(problemOf({ rangeFrom: 20_000, nextNumber: 20_000 })).toBe("Кінець діапазону раніше за початок");
  });

  it("keeps the next number inside, or one past the end for a series used up", () => {
    expect(problemOf({ nextNumber: 20_000 })).toBeUndefined();
    expect(problemOf({ nextNumber: 20_001 })).toBe("Наступний номер має бути в межах від 10000 до 19999");
    expect(problemOf({ nextNumber: 9_999 })).toBeTruthy();
  });

  it("counts a type once", () => {
    expect(idSeriesCreateSchema.parse(form({ types: ["B2C", "B2C"] })).types).toEqual(["B2C"]);
  });
});
