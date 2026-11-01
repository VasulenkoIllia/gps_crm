import { describe, expect, it } from "vitest";
import { generateRecoveryCodes, hashRecoveryCode, isRecoveryCodeShape, RECOVERY_CODE_COUNT } from "./recovery-codes.js";

describe("recovery codes", () => {
  const codes = generateRecoveryCodes();

  it("gives ten different codes in groups of four", () => {
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    expect(codes[0]).toMatch(/^[2-9a-z]{4}-[2-9a-z]{4}-[2-9a-z]{4}-[2-9a-z]{4}$/);
  });

  it("does not take a six-digit code for one", () => {
    expect(isRecoveryCodeShape("123456")).toBe(false);
  });

  it("hashes alike however it is copied", () => {
    const code = codes[0] ?? "";
    expect(hashRecoveryCode(code.toUpperCase().replaceAll("-", " "))).toBe(hashRecoveryCode(code));
    expect(isRecoveryCodeShape(code.toUpperCase())).toBe(true);
  });
});
