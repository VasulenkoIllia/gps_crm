import type { UserListItem } from "@gps_crm/shared";
import { describe, expect, it } from "vitest";
import { actionsFor } from "./UserActions";

const USER: UserListItem = {
  id: "1",
  email: "a@b.co",
  fullName: "Олена",
  roleKey: "manager",
  status: "active",
  twoFactorEnabled: true,
  lastLoginAt: null,
};

describe("actionsFor", () => {
  it("offers an active colleague the reset of 2FA", () => {
    expect(actionsFor(USER, false)).toContain("resetTwoFactor");
    expect(actionsFor(USER, false)).toContain("block");
  });

  it("hides the reset of 2FA when there is nothing to reset", () => {
    expect(actionsFor({ ...USER, twoFactorEnabled: false }, false)).not.toContain("resetTwoFactor");
  });

  it("gives a person nothing to do to themselves: the server refuses both", () => {
    expect(actionsFor(USER, true)).toEqual([]);
  });

  it("leaves only unblocking for a blocked person", () => {
    expect(actionsFor({ ...USER, status: "blocked" }, false)).toEqual(["unblock"]);
  });

  it("offers an invited person a new link", () => {
    expect(actionsFor({ ...USER, status: "invited" }, false)).toEqual(["reinvite", "copyInvite", "block"]);
  });
});
