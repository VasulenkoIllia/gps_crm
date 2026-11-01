import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, hotp, matchStep, otpauthUri, stepAt } from "./totp.js";

const STEP_MS = 30_000;
// RFC 4226 appendix D: the ASCII secret "12345678901234567890"
const RFC_KEY = Buffer.from("12345678901234567890");
const RFC_CODES = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];

describe("hotp", () => {
  it.each(RFC_CODES.map((code, counter) => [counter, code] as const))("counter %i gives %s", (counter, code) => {
    expect(hotp(RFC_KEY, counter)).toBe(code);
  });
});

describe("base32", () => {
  it("survives a round trip", () => {
    const secret = generateTotpSecret();
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("refuses what is not base32", () => {
    expect(() => base32Decode("1!")).toThrow();
  });
});

describe("matchStep", () => {
  const secret = generateTotpSecret();
  const key = base32Decode(secret);
  const now = 1_800_000_000_000;
  const current = stepAt(now);

  it("accepts the current step and one either side", () => {
    expect(matchStep(secret, hotp(key, current), now)).toBe(current);
    expect(matchStep(secret, hotp(key, current - 1), now)).toBe(current - 1);
    expect(matchStep(secret, hotp(key, current + 1), now)).toBe(current + 1);
  });

  it("refuses two steps away", () => {
    expect(matchStep(secret, hotp(key, current - 2), now)).toBeNull();
    expect(matchStep(secret, hotp(key, current + 2), now)).toBeNull();
  });

  it("takes spaces and refuses what is not six digits", () => {
    const code = hotp(key, current);
    expect(matchStep(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(current);
    expect(matchStep(secret, "12345", now)).toBeNull();
    expect(matchStep(secret, "abcdef", now)).toBeNull();
  });

  it("moves with the clock", () => {
    expect(stepAt(now + STEP_MS)).toBe(current + 1);
  });
});

describe("otpauthUri", () => {
  it("names the system and the person", () => {
    const uri = otpauthUri("GPS Облік", "a@b.co", "ABC");
    expect(uri).toMatch(/^otpauth:\/\/totp\/GPS%20/);
    expect(uri).toContain("a%40b.co");
    expect(uri).toContain("secret=ABC");
  });
});
