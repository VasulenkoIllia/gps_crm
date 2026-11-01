import { describe, expect, it } from "vitest";
import { readFilters, readSort, withFilter } from "./url-filters";

const KEYS = ["from", "action"] as const;

describe("readFilters", () => {
  it("takes only the known keys that have a value", () => {
    const params = new URLSearchParams("from=2026-11-01&action=&page=2");
    expect(readFilters(params, KEYS)).toEqual({ from: "2026-11-01" });
  });
});

describe("withFilter", () => {
  it("sets a value and keeps the others", () => {
    const next = withFilter(new URLSearchParams("from=2026-11-01"), "action", "user.blocked");
    expect(next.toString()).toBe("from=2026-11-01&action=user.blocked");
  });

  it("drops a cleared filter from the address", () => {
    const next = withFilter(new URLSearchParams("from=2026-11-01&action=user.blocked"), "action", undefined);
    expect(next.toString()).toBe("from=2026-11-01");
  });

  it("leaves what it was given alone", () => {
    const params = new URLSearchParams("from=2026-11-01");
    withFilter(params, "from", undefined);
    expect(params.toString()).toBe("from=2026-11-01");
  });
});

describe("readSort", () => {
  const SORTS = ["name", "createdAt"] as const;

  it("reads a known key and its order", () => {
    expect(readSort(new URLSearchParams("sort=name&order=desc"), SORTS)).toEqual({ key: "name", order: "desc" });
  });

  it("goes up unless told otherwise, also on a hand-edited order", () => {
    expect(readSort(new URLSearchParams("sort=name&order=sideways"), SORTS)).toEqual({ key: "name", order: "asc" });
  });

  it("leaves the order of the server when the key means nothing", () => {
    expect(readSort(new URLSearchParams("sort=phone"), SORTS)).toBeUndefined();
    expect(readSort(new URLSearchParams(), SORTS)).toBeUndefined();
  });
});
