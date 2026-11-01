import type { AccessScope, PermissionKey, RoleKey } from "@gps_crm/shared";
import { hashToken } from "../crypto/tokens.js";
import type { DbOrTx } from "../db/client.js";
import { LAST_SEEN_STEP_MS, SESSION_IDLE_MS, touchSession } from "./session.repository.js";

// Who the request is, read once per request. 2FA is derived from the credential rather than stored on the session, so
// a reset of 2FA takes effect at once (К2).
export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  roleKey: RoleKey;
  twoFactorEnabled: boolean;
  permissions: ReadonlyMap<PermissionKey, AccessScope>;
}

const ACTIVE_STATUS = "active";

export async function readAuthContext(db: DbOrTx, token: string): Promise<AuthContext | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastSeenAt: true,
      user: {
        select: {
          id: true,
          email: true,
          fullName: true,
          status: true,
          role: { select: { key: true, permissions: { select: { key: true, scope: true } } } },
          twoFactorCredential: { select: { confirmedAt: true } },
        },
      },
    },
  });
  if (!session) return null;
  const now = Date.now();
  const isDead = session.expiresAt.getTime() <= now || session.lastSeenAt.getTime() + SESSION_IDLE_MS <= now;
  if (isDead || session.user.status !== ACTIVE_STATUS) return null;
  if (now - session.lastSeenAt.getTime() >= LAST_SEEN_STEP_MS) await touchSession(db, session.id);

  const { user } = session;
  return {
    sessionId: session.id,
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    roleKey: user.role.key as RoleKey,
    twoFactorEnabled: Boolean(user.twoFactorCredential?.confirmedAt),
    permissions: new Map(user.role.permissions.map(({ key, scope }) => [key as PermissionKey, scope])),
  };
}
