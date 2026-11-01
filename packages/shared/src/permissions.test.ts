import { describe, expect, it } from "vitest";
import { ACCESS_SCOPE, PERMISSION_KEYS, PERMISSIONS, ROLE_KEYS } from "./permissions.ts";

describe("permission registry", () => {
  it("names keys as area.action", () => {
    expect(PERMISSION_KEYS.filter((key) => !/^[a-z]+(\.[a-z]+)+$/.test(key))).toEqual([]);
  });

  it("allows the level stage 1 grants on every permission", () => {
    const withoutAll = PERMISSION_KEYS.filter(
      (key) => !(PERMISSIONS[key].scopes as readonly string[]).includes(ACCESS_SCOPE.all),
    );
    expect(withoutAll).toEqual([]);
  });

  it("gives every permission a label and a group", () => {
    expect(PERMISSION_KEYS.filter((key) => !PERMISSIONS[key].label || !PERMISSIONS[key].group)).toEqual([]);
  });

  it("holds the three roles of the client's brief", () => {
    expect(ROLE_KEYS).toEqual(["admin", "manager", "technician"]);
  });
});
