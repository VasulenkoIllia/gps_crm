import { describe, expect, it } from "vitest";
import { findActiveKeys, NAV_ITEMS, navSections } from "./nav";

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

// The menu of 05.11.2026: the same twelve items under three headings
describe("navSections", () => {
  it("puts the home page on top and the rest under their headings", () => {
    const sections = navSections(NAV_ITEMS);
    expect(sections.map(({ group, items }) => [group, items.length])).toEqual([
      [null, 1],
      ["Робота", 5],
      ["Контроль", 2],
      ["Налаштування", 4],
    ]);
  });

  it("drops a heading whose items a person may not open", () => {
    const allowed = NAV_ITEMS.filter((item) => item.group !== "Контроль");
    expect(navSections(allowed).map(({ group }) => group)).toEqual([null, "Робота", "Налаштування"]);
  });
});
