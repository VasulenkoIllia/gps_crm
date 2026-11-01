import { describe, expect, it } from "vitest";
import { isValidEdrpou, isValidIpn, taxIdSchema } from "./tax-id.ts";

const messageOf = (value: string) => taxIdSchema.safeParse(value).error?.issues[0]?.message;

describe("tax numbers", () => {
  it.each(["12345678", "87654322"])("takes %s as ЄДРПОУ", (code) => {
    expect(isValidEdrpou(code)).toBe(true);
  });

  it.each(["12345679", "1234567", "123456789", "1234567a"])("refuses %s as ЄДРПОУ", (code) => {
    expect(isValidEdrpou(code)).toBe(false);
  });

  it("checks ІПН by its last digit", () => {
    expect(isValidIpn("1234567899")).toBe(true);
    expect(isValidIpn("1234567890")).toBe(false);
  });

  it("names the problem of each kind of number", () => {
    expect(messageOf("123")).toBe("Перевірте ЄДРПОУ: 8 цифр");
    expect(messageOf("12345679")).toBe("ЄДРПОУ з помилкою в контрольній цифрі");
    expect(messageOf("12345678901")).toBe("Перевірте ІПН: 10 цифр");
    expect(messageOf("1234567890")).toBe("ІПН з помилкою в контрольній цифрі");
  });

  it("leaves no spaces around a number", () => {
    expect(taxIdSchema.parse(" 12345678 ")).toBe("12345678");
  });
});
