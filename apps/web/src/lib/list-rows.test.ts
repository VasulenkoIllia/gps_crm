import { describe, expect, it } from "vitest";
import { listRows } from "./list-rows";

describe("listRows", () => {
  it("joins the pages", () => {
    expect(listRows({ pages: [{ items: [1, 2] }, { items: [3] }] }, false)).toEqual([1, 2, 3]);
  });

  it("keeps the old rows while a new filter loads", () => {
    expect(listRows({ pages: [{ items: [1] }] }, true)).toEqual([1]);
  });

  it("does not pass an old empty result for the answer to a new filter", () => {
    expect(listRows({ pages: [{ items: [] }] }, true)).toBeUndefined();
  });

  it("keeps an empty result that is the answer", () => {
    expect(listRows({ pages: [{ items: [] }] }, false)).toEqual([]);
  });

  it("has nothing before the first page", () => {
    expect(listRows(undefined, false)).toBeUndefined();
  });
});
