import type { DbOrTx } from "../db/client.js";
import { generateToken } from "../crypto/tokens.js";

const MS_PER_HOUR = 60 * 60 * 1_000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
export const SESSION_IDLE_MS = 7 * MS_PER_DAY;
export const SESSION_MAX_AGE_MS = 30 * MS_PER_DAY;
// Often enough for «last seen» and the idle limit, rarely enough not to write on every request
export const LAST_SEEN_STEP_MS = MS_PER_HOUR;

export interface NewSession {
  token: string;
  expiresAt: Date;
}

export interface SessionOrigin {
  ip: string | null;
  userAgent: string | null;
}

// A new id on every sign-in (П6), so a cookie planted before it opens nothing
export async function createSession(db: DbOrTx, userId: string, origin: SessionOrigin): Promise<NewSession> {
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
  await db.session.create({
    data: { tokenHash: hash, userId, expiresAt, ip: origin.ip, userAgent: origin.userAgent },
  });
  return { token: raw, expiresAt };
}

export async function touchSession(db: DbOrTx, id: string): Promise<void> {
  await db.session.updateMany({ where: { id }, data: { lastSeenAt: new Date() } });
}

// Enough for any real person: a live session lasts at most 30 days
const SESSIONS_SHOWN = 100;

export function listUserSessions(db: DbOrTx, userId: string) {
  const idleSince = new Date(Date.now() - SESSION_IDLE_MS);
  return db.session.findMany({
    where: { userId, expiresAt: { gt: new Date() }, lastSeenAt: { gt: idleSince } },
    orderBy: { lastSeenAt: "desc" },
    take: SESSIONS_SHOWN,
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true },
  });
}

export async function deleteUserSession(db: DbOrTx, userId: string, id: string): Promise<boolean> {
  const { count } = await db.session.deleteMany({ where: { id, userId } });
  return count === 1;
}

export async function deleteSessionById(db: DbOrTx, id: string): Promise<void> {
  await db.session.deleteMany({ where: { id } });
}

export async function deleteAllUserSessions(db: DbOrTx, userId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId } });
}

export async function deleteOtherUserSessions(db: DbOrTx, userId: string, keepId: string): Promise<void> {
  await db.session.deleteMany({ where: { userId, id: { not: keepId } } });
}

export async function deleteDeadSessions(db: DbOrTx): Promise<number> {
  const now = Date.now();
  const { count } = await db.session.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date(now) } }, { lastSeenAt: { lt: new Date(now - SESSION_IDLE_MS) } }] },
  });
  return count;
}
