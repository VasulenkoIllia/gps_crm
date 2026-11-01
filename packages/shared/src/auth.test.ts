import { describe, expect, it } from "vitest";
import { emailSchema, loginInputSchema, newPasswordSchema, normalizeEmail } from "./auth.ts";

describe("emailSchema", () => {
  it("lowers the case and trims, so one person has one login", () => {
    expect(emailSchema.parse("  Olena.Koval@Example.COM ")).toBe("olena.koval@example.com");
    expect(normalizeEmail("A@B.CO")).toBe("a@b.co");
  });

  it.each(["", "not-an-email", "a@", `${"a".repeat(250)}@b.co`])("refuses %j", (value) => {
    expect(emailSchema.safeParse(value).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("takes 10 characters of any kind", () => {
    expect(newPasswordSchema.safeParse("дуже довгий").success).toBe(true);
  });

  it("refuses 9", () => {
    expect(newPasswordSchema.safeParse("123456789").success).toBe(false);
  });

  it("refuses a password too long to be worth hashing", () => {
    expect(newPasswordSchema.safeParse("x".repeat(201)).success).toBe(false);
  });
});

describe("loginInputSchema", () => {
  it("refuses unknown keys", () => {
    expect(loginInputSchema.safeParse({ email: "a@b.co", password: "x", admin: true }).success).toBe(false);
  });
});
