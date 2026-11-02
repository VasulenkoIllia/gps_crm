import { describe, expect, it } from "vitest";
import { countText } from "./home.api";

describe("countText", () => {
  it("groups the digits and says when the count stopped at its cap", () => {
    expect(countText({ count: 7, isCapped: false })).toBe("7");
    expect(countText({ count: 10_000, isCapped: true })).toMatch(/^понад 10\s000$/);
  });
});
