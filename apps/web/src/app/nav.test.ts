import { describe, expect, it } from "vitest";
import { findActiveKeys } from "./nav";

describe("findActiveKeys", () => {
  it("marks the home item only on the home page", () => {
    expect(findActiveKeys("/")).toEqual(["/"]);
  });

  it("keeps a section active on its nested pages", () => {
    expect(findActiveKeys("/subscribers/42")).toEqual(["/subscribers"]);
  });

  it("does not take a longer path for a section", () => {
    expect(findActiveKeys("/subscribers-archive")).toEqual([]);
  });

  it("marks nothing outside the menu", () => {
    expect(findActiveKeys("/ui")).toEqual([]);
  });
});
