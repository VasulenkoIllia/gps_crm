import { describe, expect, it } from "vitest";
import { isNumberQuery, searchQuerySchema } from "./search.ts";

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
});
