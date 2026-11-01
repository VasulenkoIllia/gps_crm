import type { DbOrTx } from "../../core/db/client.js";

export function findCredential(db: DbOrTx, userId: string) {
  return db.twoFactorCredential.findUnique({ where: { userId } });
}

// A new setup replaces an unfinished one: nothing is on until a code from the phone confirms it. One statement, so a
// setup next to a confirm in another tab cannot write over a secret that is already on. False when one is.
export async function savePendingSecret(db: DbOrTx, userId: string, secretEncrypted: string): Promise<boolean> {
  const saved = await db.$executeRaw`
    INSERT INTO two_factor_credentials (user_id, secret_encrypted)
    VALUES (${userId}::uuid, ${secretEncrypted})
    ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, last_step = NULL
    WHERE two_factor_credentials.confirmed_at IS NULL
  `;
  return saved === 1;
}

// Names the secret the code was checked against: one replaced in between must not go live unproven
export async function confirmCredential(
  db: DbOrTx,
  credential: { id: string; secretEncrypted: string },
  step: number,
): Promise<boolean> {
  const { count } = await db.twoFactorCredential.updateMany({
    where: { id: credential.id, secretEncrypted: credential.secretEncrypted, confirmedAt: null },
    data: { confirmedAt: new Date(), lastStep: step },
  });
  return count === 1;
}

export async function advanceStep(db: DbOrTx, id: string, step: number): Promise<boolean> {
  const { count } = await db.twoFactorCredential.updateMany({
    where: { id, OR: [{ lastStep: null }, { lastStep: { lt: step } }] },
    data: { lastStep: step },
  });
  return count === 1;
}

export async function replaceRecoveryCodes(db: DbOrTx, credentialId: string, hashes: string[]): Promise<void> {
  await db.twoFactorRecoveryCode.deleteMany({ where: { credentialId } });
  await db.twoFactorRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ credentialId, codeHash })) });
}

export async function consumeRecoveryCode(db: DbOrTx, credentialId: string, codeHash: string): Promise<boolean> {
  const { count } = await db.twoFactorRecoveryCode.updateMany({
    where: { credentialId, codeHash, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

export function countUnusedRecoveryCodes(db: DbOrTx, credentialId: string): Promise<number> {
  return db.twoFactorRecoveryCode.count({ where: { credentialId, usedAt: null } });
}

// The codes go with it: they belong to this credential and mean nothing without it
export async function deleteCredential(db: DbOrTx, userId: string): Promise<boolean> {
  const { count } = await db.twoFactorCredential.deleteMany({ where: { userId } });
  return count === 1;
}
