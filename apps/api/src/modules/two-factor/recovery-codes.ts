import { randomInt } from "node:crypto";
import { hashToken } from "../../core/crypto/tokens.js";

export const RECOVERY_CODE_COUNT = 10;
// Nothing to misread: no 0/o, 1/l/i
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
// About 79 bits. Random enough for a plain SHA-256: a slow hash is for what people choose, and ten argon2 checks at
// once would not fit the container. No key either, so a lost SECRETS_KEY leaves this way in open (RESTORE.md).
const LENGTH = 16;
const GROUP = 4;

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const characters = Array.from({ length: LENGTH }, () => ALPHABET.charAt(randomInt(ALPHABET.length)));
    return characters.join("").replace(new RegExp(`(.{${GROUP}})(?=.)`, "g"), "$1-");
  });
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isRecoveryCodeShape(input: string): boolean {
  const code = normalize(input);
  return code.length === LENGTH && [...code].every((character) => ALPHABET.includes(character));
}

export function hashRecoveryCode(input: string): string {
  return hashToken(normalize(input));
}
