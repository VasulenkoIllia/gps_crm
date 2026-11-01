import { describe, expect, it } from "vitest";
import { referenceListQuery } from "./references.api";

describe("referenceListQuery", () => {
  it("asks for nothing when nothing is chosen", () => {
    expect(referenceListQuery({})).toBe("");
    expect(referenceListQuery({ cursor: null })).toBe("");
  });

  it("carries the filter, the next page and the size of a whole list", () => {
    const query = new URLSearchParams(referenceListQuery({ status: "inactive", cursor: "next", limit: 500 }));
    expect(Object.fromEntries(query)).toEqual({ status: "inactive", cursor: "next", limit: "500" });
  });
});
