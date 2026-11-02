import { describe, expect, it } from "vitest";
import { excelDate, safeCell } from "./exports.columns.js";

describe("the cells of an export", () => {
  it.each(["=1+1", "+1+cmd|' /C calc'!A0", "-5", "@SUM(A1)"])("keeps %s a text, not a formula", (value) => {
    expect(safeCell(value)).toBe(`'${value}`);
  });

  it("leaves everything else as it is, a phone number too", () => {
    expect(safeCell("+380671234567")).toBe("+380671234567");
    expect(safeCell("Клієнт = 1")).toBe("Клієнт = 1");
    expect(safeCell(-5)).toBe(-5);
    expect(safeCell(null)).toBeNull();
  });

  it("turns a business date into a date of Excel at midnight UTC", () => {
    expect(excelDate("2026-11-02")?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(excelDate(null)).toBeNull();
  });
});
