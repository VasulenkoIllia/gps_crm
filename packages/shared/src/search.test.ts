import { describe, expect, it } from "vitest";
import { isNumberQuery, searchQuerySchema, searchTooShortText } from "./search.ts";

describe("the global search", () => {
  it.each(["356938", "+38 (050) 111-22-33", "12345"])("takes %s for a number", (text) => {
    expect(isNumberQuery(text)).toBe(true);
  });

  it.each(["Ромашка", "А-17/2", "ab1234", "+-"])("takes %s for a text", (text) => {
    expect(isNumberQuery(text)).toBe(false);
  });

  it("trims the query and refuses an empty one", () => {
    expect(searchQuerySchema.parse({ q: "  тягач " })).toEqual({ q: "тягач" });
    expect(searchQuerySchema.safeParse({ q: "   " }).success).toBe(false);
  });

  it("says why a short query finds nothing, counting it as the server does", () => {
    expect(searchTooShortText(undefined)).toBeNull();
    expect(searchTooShortText("аб")).toBe("Введіть щонайменше 3 символи");
    expect(searchTooShortText("а   б")).toBeNull();
    expect(searchTooShortText("123")).toBe("Введіть щонайменше 4 цифри");
    expect(searchTooShortText("тягач")).toBeNull();
  });
});
