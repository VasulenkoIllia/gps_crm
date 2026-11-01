import { describe, expect, it } from "vitest";
import { loginPath, safeNextPath } from "./login-path";

describe("safeNextPath", () => {
  it("keeps a path of this app", () => {
    expect(safeNextPath("/users?tab=all")).toBe("/users?tab=all");
  });

  it("keeps what follows the path", () => {
    expect(safeNextPath("/users?tab=all#row")).toBe("/users?tab=all#row");
  });

  it.each([
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\t/evil.test",
    "/\n/evil.test",
    "/\r\\evil.test",
    "//",
    "/.//evil.test",
    "/..//evil.test",
    "/a/..//evil.test",
    "/%2e//evil.test",
    "evil",
    "",
    null,
  ])("refuses %j", (next) => {
    expect(safeNextPath(next)).toBe("/");
  });
});

describe("loginPath", () => {
  it("remembers where the person was", () => {
    expect(loginPath("/users?a=1")).toBe("/login?next=%2Fusers%3Fa%3D1");
  });

  it("stays plain for the home page", () => {
    expect(loginPath("/")).toBe("/login");
  });
});
