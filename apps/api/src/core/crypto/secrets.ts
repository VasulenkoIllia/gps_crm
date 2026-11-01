import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = "v1";
const ENCODING = "base64url";

// AES-GCM authenticates as well as encrypts, so a changed row fails at open instead of giving a wrong secret, and
// `owner` fails a value copied onto somebody else's row. A dump alone opens nothing, which is why .env must never share
// a backup with it (RESTORE.md).
export function sealSecret(key: Buffer, plaintext: string, owner: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES }).setAAD(Buffer.from(owner));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [FORMAT, iv.toString(ENCODING), cipher.getAuthTag().toString(ENCODING), ciphertext.toString(ENCODING)].join(
    ".",
  );
}

export function openSecret(key: Buffer, sealed: string, owner: string): string {
  const [format, iv, tag, ciphertext] = sealed.split(".");
  if (format !== FORMAT || iv === undefined || tag === undefined || ciphertext === undefined) {
    throw new Error("unknown format of a sealed secret");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, ENCODING), { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(owner)).setAuthTag(Buffer.from(tag, ENCODING));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, ENCODING)), decipher.final()]).toString("utf8");
}
