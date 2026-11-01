import type { RoleKey, UserStatus } from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import type { AuthTokenType } from "../../generated/prisma/client.js";

export type { AuthTokenType };

const FIRST_ADMIN_LOCK = 7_204_511;

export function findUserByEmail(db: DbOrTx, email: string) {
  return db.user.findUnique({ where: { email } });
}

export function findUserById(db: DbOrTx, id: string) {
  return db.user.findUnique({ where: { id } });
}

export function countUsers(db: DbOrTx): Promise<number> {
  return db.user.count();
}

// Whatever changes who a person is or what opens their account takes these rows first, always in one order: the changes
// to one person run one at a time, and two transactions cannot deadlock over a user and their tokens. NO KEY, because
// a new session or token only needs the row to stay, and must not wait.
export async function lockUsers(tx: DbOrTx, ids: string[]): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
}

// Nothing to lock yet on an empty table
export async function lockFirstAdminCreation(tx: DbOrTx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FIRST_ADMIN_LOCK}::bigint)`;
}

export async function createUser(
  db: DbOrTx,
  input: {
    email: string;
    fullName: string;
    roleKey: RoleKey;
    status: UserStatus;
    passwordHash: string | null;
    createdBy: string | null;
  },
): Promise<{ id: string }> {
  const { roleKey, ...user } = input;
  return db.user.create({ data: { ...user, role: { connect: { key: roleKey } } }, select: { id: true } });
}

export async function updateFullName(db: DbOrTx, id: string, fullName: string): Promise<void> {
  await db.user.update({ where: { id }, data: { fullName, updatedBy: id } });
}

export async function setPassword(db: DbOrTx, id: string, passwordHash: string): Promise<void> {
  await db.user.update({ where: { id }, data: { passwordHash, updatedBy: id } });
}

export async function activateUser(db: DbOrTx, id: string, passwordHash: string): Promise<void> {
  await db.user.update({ where: { id }, data: { passwordHash, status: "active", updatedBy: id } });
}

// Conditional, so two people acting on one row cannot both think they changed it
export async function changeStatus(db: DbOrTx, id: string, to: UserStatus, updatedBy: string | null): Promise<void> {
  await db.user.update({ where: { id }, data: { status: to, updatedBy } });
}

export async function touchLastLogin(db: DbOrTx, id: string): Promise<void> {
  await db.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
}

export async function createAuthToken(
  db: DbOrTx,
  input: { userId: string; type: AuthTokenType; tokenHash: string; expiresAt: Date; createdBy: string | null },
): Promise<void> {
  await db.authToken.create({ data: input });
}

export function findLiveToken(db: DbOrTx, tokenHash: string, type: AuthTokenType) {
  return db.authToken.findFirst({ where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } } });
}

// False when another request spent it first: a double submit loses here
export async function consumeToken(db: DbOrTx, id: string): Promise<boolean> {
  const { count } = await db.authToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1;
}

export async function revokeUserTokens(db: DbOrTx, userId: string, types?: AuthTokenType[]): Promise<void> {
  await db.authToken.updateMany({
    where: { userId, usedAt: null, ...(types ? { type: { in: types } } : {}) },
    data: { usedAt: new Date() },
  });
}

// A try is taken before the code is looked at, so parallel guesses cannot share one
export async function claimTokenAttempt(db: DbOrTx, id: string, maxAttempts: number): Promise<boolean> {
  const { count } = await db.authToken.updateMany({
    where: { id, usedAt: null, attempts: { lt: maxAttempts } },
    data: { attempts: { increment: 1 } },
  });
  return count === 1;
}

export async function deleteDeadTokens(db: DbOrTx): Promise<number> {
  const { count } = await db.authToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
