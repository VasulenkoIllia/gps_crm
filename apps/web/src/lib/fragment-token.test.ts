import { describe, expect, it } from "vitest";
import { readFragmentToken } from "./fragment-token";

describe("readFragmentToken", () => {
  it("takes the token from the fragment", () => {
    expect(readFragmentToken("#token=abc-DEF_1")).toBe("abc-DEF_1");
  });

  it.each(["", "#", "#other=1"])("finds nothing in %j", (hash) => {
    expect(readFragmentToken(hash)).toBeNull();
  });
});
