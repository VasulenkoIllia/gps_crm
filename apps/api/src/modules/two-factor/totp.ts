import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238, the parameters every authenticator app implements. SHA-1's collision weakness does not reach HMAC.
const STEP_SECONDS = 30;
const DIGITS = 6;
// П7: ±1 step. totp.test.ts holds the boundary
const WINDOW = 1;
const SECRET_BYTES = 20;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MS_PER_SECOND = 1_000;
const BASE32_BITS = 5;
const BYTE_BITS = 8;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << BYTE_BITS) | byte;
    bits += BYTE_BITS;
    while (bits >= BASE32_BITS) {
      out += BASE32[(value >>> (bits - BASE32_BITS)) & 31];
      bits -= BASE32_BITS;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (BASE32_BITS - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of input) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error("not a base32 string");
    value = (value << BASE32_BITS) | index;
    bits += BASE32_BITS;
    if (bits >= BYTE_BITS) {
      out.push((value >>> (bits - BYTE_BITS)) & 0xff);
      bits -= BYTE_BITS;
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(out);
}

export function hotp(key: Uint8Array, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(BYTE_BITS);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(message).digest();
  const offset = (mac.at(-1) ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function stepAt(ms: number): number {
  return Math.floor(ms / MS_PER_SECOND / STEP_SECONDS);
}

function isSameCode(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// The step a code belongs to, or null. Every step of the window is compared whatever happens, so the time taken does
// not say how close a guess came. Single use is the caller's: only a conditional write can say nobody spent it first.
export function matchStep(secret: string, code: string, nowMs: number): number | null {
  const typed = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${DIGITS}}$`).test(typed)) return null;
  const key = base32Decode(secret);
  const current = stepAt(nowMs);
  let found: number | null = null;
  for (let step = current + WINDOW; step >= current - WINDOW; step--) {
    if (isSameCode(hotp(key, step), typed) && found === null) found = step;
  }
  return found;
}

export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
