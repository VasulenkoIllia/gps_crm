import { describe, expect, it } from "vitest";
import { HEALTH_STATUS, parseHealthResponse } from "./index.ts";

describe("parseHealthResponse", () => {
  it.each(Object.values(HEALTH_STATUS))("accepts status %s", (status) => {
    expect(parseHealthResponse({ status })).toEqual({ status });
  });

  it("rejects an unknown status", () => {
    expect(() => parseHealthResponse({ status: "maybe" })).toThrow();
  });

  it("rejects unknown keys", () => {
    expect(() => parseHealthResponse({ status: "ok", detail: "x" })).toThrow();
  });
});
