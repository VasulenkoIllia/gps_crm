import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Only the hash is stored: a dump opens no session and accepts no invitation
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashToken(raw) };
}
