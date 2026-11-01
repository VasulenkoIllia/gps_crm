import { describe, expect, it } from "vitest";
import { activityQuery } from "./activity.api";

const asParams = (query: string) => Object.fromEntries(new URLSearchParams(query));

describe("activityQuery", () => {
  it("asks for nothing when nothing is chosen", () => {
    expect(activityQuery({}, null)).toBe("");
  });

  it("turns a Kyiv period into one that ends where the next day starts", () => {
    const query = activityQuery({ from: "2026-11-01", to: "2026-11-01" }, null);
    expect(asParams(query)).toEqual({ from: "2026-10-31T22:00:00.000Z", to: "2026-11-01T22:00:00.000Z" });
  });

  it("passes the other filters and the cursor as they are", () => {
    const query = activityQuery({ action: "user.blocked", entityType: "user" }, "next");
    expect(asParams(query)).toEqual({ action: "user.blocked", entityType: "user", cursor: "next" });
  });

  it("leaves out a date edited by hand into something else", () => {
    expect(activityQuery({ from: "yesterday", to: "2026-99-99" }, null)).toBe("");
  });
});
