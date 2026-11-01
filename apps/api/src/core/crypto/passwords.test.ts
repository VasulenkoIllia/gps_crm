import { describe, expect, it } from "vitest";
import { assertStrongPassword, hashPassword, verifyPassword } from "./passwords.js";

describe("hashPassword", () => {
  it("uses argon2id and verifies", async () => {
    const hash = await hashPassword("довгий пароль");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "довгий пароль")).toBe(true);
    expect(await verifyPassword(hash, "інший пароль")).toBe(false);
  });
});

describe("assertStrongPassword", () => {
  it.each(["correct horse battery", "Вишневий сад 1904", "x7#kQ9!mZ2"])("accepts %s", (password) => {
    expect(() => assertStrongPassword(password, ["a@b.co", "Олена Коваль"])).not.toThrow();
  });

  it.each(["qwertyuiop", "QWERTYUIOP", "1234567890", "password123", "йцукенгшщз", "aaaaaaaaaaaa", "ababababab"])(
    "refuses %s",
    (password) => {
      expect(() => assertStrongPassword(password, [])).toThrow("Пароль занадто простий або поширений");
    },
  );

  it("refuses the person's own email or name", () => {
    expect(() => assertStrongPassword("Olena@Example.test", ["olena@example.test"])).toThrow();
    expect(() => assertStrongPassword("олена коваль", ["Олена Коваль"])).toThrow();
  });
});
