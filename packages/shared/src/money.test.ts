import { describe, expect, it } from "vitest";
import { formatMoney, moneyTextSchema, moneyToText, parseMoneyToKop } from "./money.ts";

describe("money", () => {
  it("shows kopecks as the system's one format", () => {
    expect(formatMoney(123_456)).toBe("1 234,56 грн");
    expect(formatMoney(16_000)).toBe("160,00 грн");
    expect(formatMoney(7)).toBe("0,07 грн");
  });

  it.each([
    ["160", 16_000],
    ["160,5", 16_050],
    ["1 234,56", 123_456],
    ["0.07", 7],
    ["19,99", 1_999],
  ])("reads %s without losing a kopeck", (text, kop) => {
    expect(parseMoneyToKop(text)).toBe(kop);
  });

  it.each(["", "abc", "1,234", "-5", "1,2,3", "1e3"])("does not take %s for a sum", (text) => {
    expect(parseMoneyToKop(text)).toBeNull();
  });

  it("gives an edit form the digits back unchanged", () => {
    for (const kop of [1, 99, 100, 16_000, 123_456]) {
      expect(parseMoneyToKop(moneyToText(kop))).toBe(kop);
    }
  });

  it("refuses a price of zero or above the limit in the form too", () => {
    expect(moneyTextSchema.safeParse("0").success).toBe(false);
    expect(moneyTextSchema.safeParse("0,00").success).toBe(false);
    expect(moneyTextSchema.safeParse("0,01").success).toBe(true);
    expect(moneyTextSchema.safeParse("99999999").success).toBe(true);
    expect(moneyTextSchema.safeParse(undefined).success).toBe(false);
  });
});
