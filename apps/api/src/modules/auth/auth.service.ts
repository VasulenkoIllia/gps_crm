import {
  LOGIN_STATUS,
  USER_STATUS,
  type LinkDelivery,
  type LoginInput,
  type LoginResult,
  type PasswordChange,
  type PasswordResetConfirm,
  type TwoFactorLoginInput,
} from "@gps_crm/shared";
import {
  recordActivity,
  SYSTEM_ACTOR,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import { assertStrongPassword, burnPasswordCheck, hashPassword, verifyPassword } from "../../core/crypto/passwords.js";
import { generateToken, hashToken } from "../../core/crypto/tokens.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { passwordResetLetter } from "../../core/email/templates.js";
import { AppError } from "../../core/errors.js";
import type { AuthContext } from "../../core/session/session.queries.js";
import {
  createSession,
  deleteAllUserSessions,
  deleteOtherUserSessions,
  deleteSessionById,
  deleteUserSession,
  listUserSessions,
  type NewSession,
  type SessionOrigin,
} from "../../core/session/session.repository.js";
import {
  accountKey,
  claimAttempt,
  claimResetLetter,
  clearFailures,
  pairKey,
  secondFactorKey,
} from "../../core/throttle/throttle.js";
import { completeChallenge, startChallenge } from "../two-factor/index.js";
import {
  confirmPassword,
  consumeToken,
  createAuthToken,
  deliverLink,
  findLiveToken,
  findUserByEmail,
  findUserById,
  lockUsers,
  revokeUserTokens,
  setPassword,
  tooManyAttempts,
  touchLastLogin,
  type AuthTokenType,
} from "../users/index.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1_000;
const INVALID_CREDENTIALS = "Неправильний email або пароль";
const RESET_LINK_EXPIRED = "Посилання застаріло. Попросіть нове";
// A link still lying in a chat, or a sign-in begun with the old password, ends with that password
const AFTER_PASSWORD_CHANGE: AuthTokenType[] = ["password_reset", "two_factor_challenge"];

export interface LoginOutcome {
  result: LoginResult;
  session?: NewSession;
}

function resetLink(deps: AppDeps, token: string): string {
  return `${deps.config.appUrl}/reset-password#token=${token}`;
}

async function createResetToken(db: DbOrTx, userId: string, createdBy: string | null): Promise<string> {
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await createAuthToken(db, { userId, type: "password_reset", tokenHash: hash, expiresAt, createdBy });
  return raw;
}

async function openSession(
  tx: DbOrTx,
  context: ActivityContext,
  userId: string,
  origin: SessionOrigin,
): Promise<NewSession> {
  await touchLastLogin(tx, userId);
  await recordActivity(
    tx,
    { ...context, actor: { kind: "user", id: userId } },
    { action: "auth.login", entityType: "user", entityId: userId, retentionClass: "security" },
  );
  return createSession(tx, userId, origin);
}

// A refused sign-in stays the same answer whatever the journal does: a failure here is logged and goes no further
async function noteFailedLogin(
  deps: AppDeps,
  context: ActivityContext,
  event: Pick<ActivityEventInput, "entityId" | "details">,
): Promise<void> {
  try {
    await recordActivity(
      deps.db,
      { ...context, actor: SYSTEM_ACTOR },
      { action: "auth.login_failed", entityType: "user", retentionClass: "security", ...event },
    );
  } catch (error) {
    deps.logger.error({ err: error }, "a failed sign-in was not recorded");
  }
}

// The answer and the time are the same for every failure, so a stranger cannot tell which emails have accounts (П5)
export async function login(
  deps: AppDeps,
  context: ActivityContext,
  input: LoginInput,
  origin: SessionOrigin,
): Promise<LoginOutcome> {
  const keys = [accountKey(input.email), pairKey(input.email, origin.ip ?? "unknown")];
  const wait = await claimAttempt(deps.db, keys);
  if (wait > 0) {
    await noteFailedLogin(deps, context, { details: { email: input.email, reason: "throttled" } });
    throw tooManyAttempts(wait);
  }

  const user = await findUserByEmail(deps.db, input.email);
  const isPasswordRight = user?.passwordHash
    ? await verifyPassword(user.passwordHash, input.password)
    : await burnPasswordCheck(input.password).then(() => false);
  if (!user || !isPasswordRight || user.status !== USER_STATUS.active) {
    const reason = !user ? "unknown_email" : !isPasswordRight ? "wrong_password" : user.status;
    await noteFailedLogin(deps, context, { entityId: user?.id, details: { email: input.email, reason } });
    throw new AppError(401, "invalid_credentials", INVALID_CREDENTIALS);
  }

  // Under the lock confirmSetup takes as well: a password alone must not get a session past the moment 2FA goes on. The
  // check above took a while, so a password changed or a person blocked in the meantime counts as a refusal.
  return deps.db.$transaction(async (tx) => {
    await lockUsers(tx, [user.id]);
    const current = await findUserById(tx, user.id);
    if (current?.status !== USER_STATUS.active || current.passwordHash !== user.passwordHash) {
      throw new AppError(401, "invalid_credentials", INVALID_CREDENTIALS);
    }
    const challenge = await startChallenge(tx, user.id);
    if (challenge) return { result: { status: LOGIN_STATUS.twoFactorRequired, challenge } };
    await clearFailures(tx, keys);
    const session = await openSession(tx, context, user.id, origin);
    return { result: { status: LOGIN_STATUS.twoFactorSetupRequired }, session };
  });
}

export async function loginSecondStep(
  deps: AppDeps,
  context: ActivityContext,
  input: TwoFactorLoginInput,
  origin: SessionOrigin,
): Promise<NewSession> {
  const { userId, email } = await completeChallenge(deps, context, input);
  const keys = [accountKey(email), pairKey(email, origin.ip ?? "unknown"), secondFactorKey(userId)];
  return deps.db.$transaction(async (tx) => {
    await lockUsers(tx, [userId]);
    await clearFailures(tx, keys);
    return openSession(tx, context, userId, origin);
  });
}

export async function logout(deps: AppDeps, context: ActivityContext, auth: AuthContext): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    await deleteSessionById(tx, auth.sessionId);
    await recordActivity(tx, context, { action: "auth.logout", entityType: "user", entityId: auth.userId });
  });
}

export async function logoutEverywhere(deps: AppDeps, context: ActivityContext, auth: AuthContext): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    await deleteAllUserSessions(tx, auth.userId);
    await recordActivity(tx, context, {
      action: "auth.logout_everywhere",
      entityType: "user",
      entityId: auth.userId,
      retentionClass: "security",
    });
  });
}

export async function endSession(
  deps: AppDeps,
  context: ActivityContext,
  auth: AuthContext,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    if (!(await deleteUserSession(tx, auth.userId, id))) throw new AppError(404, "not_found", "Не знайдено");
    await recordActivity(tx, context, {
      action: "auth.session_ended",
      entityType: "session",
      entityId: id,
      retentionClass: "security",
    });
  });
}

export async function listSessions(deps: AppDeps, auth: AuthContext) {
  const sessions = await listUserSessions(deps.db, auth.userId);
  return sessions.map((session) => ({
    ...session,
    isCurrent: session.id === auth.sessionId,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
  }));
}

// П10. Silent for an unknown address, and nothing here decides the answer: the route does not wait for this. An earlier
// link stays alive: a stranger pressing this form must not cancel the one the person is about to open.
export async function requestPasswordReset(deps: AppDeps, context: ActivityContext, email: string): Promise<void> {
  const user = await findUserByEmail(deps.db, email);
  await recordActivity(
    deps.db,
    { ...context, actor: SYSTEM_ACTOR },
    {
      action: "auth.password_reset_requested",
      entityType: "user",
      entityId: user?.id,
      details: { email, isKnown: user !== null },
      retentionClass: "security",
    },
  );
  if (user?.status !== USER_STATUS.active || !deps.mailer.isConfigured) return;
  if (!(await claimResetLetter(deps.db, user.id))) return;
  const token = await createResetToken(deps.db, user.id, null);
  await deps.mailer.send(passwordResetLetter(user.email, resetLink(deps, token)));
}

// D12: without mail, a colleague hands the link over. The same route sends the letter once SMTP is there.
export async function createPasswordResetLink(
  deps: AppDeps,
  context: ActivityContext,
  userId: string,
  sendEmail: boolean,
): Promise<LinkDelivery> {
  const createdBy = context.actor.kind === "user" ? context.actor.id : null;
  const { user, token } = await deps.db.$transaction(async (tx) => {
    await lockUsers(tx, [userId]);
    const user = await findUserById(tx, userId);
    if (!user) throw new AppError(404, "not_found", "Не знайдено");
    if (user.status !== USER_STATUS.active) {
      throw new AppError(409, "user_not_active", "Скинути пароль можна лише активному користувачу");
    }
    await recordActivity(tx, context, {
      action: "auth.password_reset_link_created",
      entityType: "user",
      entityId: userId,
      retentionClass: "security",
    });
    await revokeUserTokens(tx, userId, ["password_reset"]);
    return { user, token: await createResetToken(tx, userId, createdBy) };
  });
  const link = resetLink(deps, token);
  return deliverLink(deps, link, passwordResetLetter(user.email, link), sendEmail);
}

// The link opens no session: a new password leads back to the two-step sign-in, because a mailbox is not a second factor
export async function confirmPasswordReset(
  deps: AppDeps,
  context: ActivityContext,
  input: PasswordResetConfirm,
): Promise<void> {
  const expired = new AppError(410, "reset_link_expired", RESET_LINK_EXPIRED);
  const token = await findLiveToken(deps.db, hashToken(input.token), "password_reset");
  if (!token) throw expired;
  const user = await findUserById(deps.db, token.userId);
  if (user?.status !== USER_STATUS.active) throw expired;
  assertStrongPassword(input.password, [user.email, user.fullName]);
  const passwordHash = await hashPassword(input.password);

  await deps.db.$transaction(async (tx) => {
    await lockUsers(tx, [user.id]);
    if (!(await consumeToken(tx, token.id))) throw expired;
    await setPassword(tx, user.id, passwordHash);
    await deleteAllUserSessions(tx, user.id);
    await revokeUserTokens(tx, user.id, AFTER_PASSWORD_CHANGE);
    await recordActivity(
      tx,
      { ...context, actor: { kind: "user", id: user.id } },
      { action: "auth.password_reset", entityType: "user", entityId: user.id, retentionClass: "security" },
    );
  });
}

// П6: the other sessions end, this one goes on
export async function changePassword(
  deps: AppDeps,
  context: ActivityContext,
  auth: AuthContext,
  input: PasswordChange,
): Promise<void> {
  await confirmPassword(deps, auth.userId, auth.email, input.currentPassword);
  assertStrongPassword(input.newPassword, [auth.email, auth.fullName]);
  const passwordHash = await hashPassword(input.newPassword);
  await deps.db.$transaction(async (tx) => {
    await setPassword(tx, auth.userId, passwordHash);
    await deleteOtherUserSessions(tx, auth.userId, auth.sessionId);
    await revokeUserTokens(tx, auth.userId, AFTER_PASSWORD_CHANGE);
    await recordActivity(tx, context, {
      action: "auth.password_changed",
      entityType: "user",
      entityId: auth.userId,
      retentionClass: "security",
    });
  });
}
