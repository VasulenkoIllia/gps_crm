import { describe, expect, it } from "vitest";
import { contractFileUrl, contractListQuery } from "./contracts.api";

describe("contractListQuery", () => {
  it("asks for nothing when nothing is chosen", () => {
    expect(contractListQuery({}, null)).toBe("");
  });

  it("carries the filters and the next page", () => {
    const query = new URLSearchParams(contractListQuery({ q: "Д-1/2026", expiring: "true" }, "next"));
    expect(Object.fromEntries(query)).toEqual({ q: "Д-1/2026", expiring: "true", cursor: "next" });
  });
});

describe("contractFileUrl", () => {
  it("asks the API to show the file, not to save it", () => {
    expect(contractFileUrl("id-1")).toBe("/api/v1/contracts/id-1/file?disposition=inline");
  });
});
