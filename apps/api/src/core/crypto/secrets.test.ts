import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "./secrets.js";

const KEY = randomBytes(32);
const OWNER = "0197a000-0000-7000-8000-000000000001";
const GCM_REFUSED = /authenticate/;

describe("sealed secrets", () => {
  it("opens what it sealed", () => {
    expect(openSecret(KEY, sealSecret(KEY, "JBSWY3DPEHPK3PXP", OWNER), OWNER)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("refuses a value copied onto somebody else's row", () => {
    const sealed = sealSecret(KEY, "secret", OWNER);
    expect(() => openSecret(KEY, sealed, "0197a000-0000-7000-8000-000000000002")).toThrow(GCM_REFUSED);
  });

  it("refuses a shortened tag, which Node would otherwise take", () => {
    const [format, iv, tag = "", ciphertext] = sealSecret(KEY, "secret", OWNER).split(".");
    const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(() => openSecret(KEY, [format, iv, short, ciphertext].join("."), OWNER)).toThrow("tag");
  });

  it("gives a new result every time, so two rows never show the same secret", () => {
    expect(sealSecret(KEY, "same", OWNER)).not.toBe(sealSecret(KEY, "same", OWNER));
  });

  it("does not open with another key", () => {
    expect(() => openSecret(randomBytes(32), sealSecret(KEY, "secret", OWNER), OWNER)).toThrow(GCM_REFUSED);
  });

  it("does not open a changed row", () => {
    const sealed = sealSecret(KEY, "secret", OWNER);
    const tail = sealed.slice(-2) === "AA" ? "BB" : "AA";
    expect(() => openSecret(KEY, `${sealed.slice(0, -2)}${tail}`, OWNER)).toThrow(GCM_REFUSED);
  });

  it("refuses an unknown format", () => {
    expect(() => openSecret(KEY, "plain text", OWNER)).toThrow("unknown format");
  });
});
