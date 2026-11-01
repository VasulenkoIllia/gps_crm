import argon2 from "argon2";
import { AppError } from "../errors.js";
import { COMMON_PASSWORDS } from "./common-passwords.js";

// OWASP's argon2id profile. The app runs in 768 MB and libuv hashes four at a time, so memory stays bounded.
const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const WEAK_PASSWORD_MESSAGE = "Пароль занадто простий або поширений";
const DIGIT_RUN = "01234567890123456789";
const MIN_DISTINCT_CHARACTERS = 4;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

let timingHash: Promise<string> | undefined;

// A login with no account pays the same price, so the time taken does not say which emails exist (П5)
export async function burnPasswordCheck(password: string): Promise<void> {
  timingHash ??= hashPassword("timing-equalizer");
  await verifyPassword(await timingHash, password);
}

function isTrivial(password: string): boolean {
  const lower = password.toLowerCase();
  return new Set(lower).size < MIN_DISTINCT_CHARACTERS || DIGIT_RUN.includes(lower);
}

// П4: no rules about composition, only a refusal of what an attacker tries first
export function assertStrongPassword(password: string, personal: string[]): void {
  const lower = password.toLowerCase();
  const isPersonal = personal.some((value) => value.length > 0 && lower === value.toLowerCase());
  if (isTrivial(password) || COMMON_PASSWORDS.has(lower) || isPersonal) {
    throw new AppError(422, "weak_password", WEAK_PASSWORD_MESSAGE, { password: WEAK_PASSWORD_MESSAGE });
  }
}
