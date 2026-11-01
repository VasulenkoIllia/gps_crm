import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone, phoneSchema, reverseDigits } from "./phone.ts";

describe("phones", () => {
  it.each(["+380671234567", "380671234567", "0671234567", "+380 67 123 45 67", "(067) 123-45-67"])(
    "reads %s as one number",
    (text) => {
      expect(normalizePhone(text)).toBe("+380671234567");
    },
  );

  it.each(["671234567", "+48671234567", "+3806712345678", "телефон", ""])("refuses %s", (text) => {
    expect(normalizePhone(text)).toBeNull();
    expect(phoneSchema.safeParse(text).error?.issues[0]?.message).toBe("Введіть номер у форматі +380 XX XXX XX XX");
  });

  it("shows a number in groups", () => {
    expect(formatPhone("+380671234567")).toBe("+380 67 123 45 67");
  });

  it("reads the digits backwards, so that an index can find how a number ends", () => {
    expect(reverseDigits("+380671234567")).toBe("765432176083");
  });
});
