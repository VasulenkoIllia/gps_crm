import {
  LINK_DELIVERY,
  USER_STATUS,
  type CurrentUser,
  type InvitationAccept,
  type InvitationInput,
  type LinkDelivery,
  type ProfileUpdate,
  type ReinviteInput,
  type UserStatus,
} from "@gps_crm/shared";
import { recordActivity, SYSTEM_ACTOR, type ActivityContext } from "../../core/activity/activity.repository.js";
import { assertStrongPassword, hashPassword, verifyPassword } from "../../core/crypto/passwords.js";
import { generateToken, hashToken } from "../../core/crypto/tokens.js";
import { isUniqueViolation, type DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import type { MailMessage } from "../../core/email/mailer.js";
import { invitationLetter } from "../../core/email/templates.js";
import { AppError } from "../../core/errors.js";
import type { AuthContext } from "../../core/session/session.queries.js";
import {
  createSession,
  deleteAllUserSessions,
  type NewSession,
  type SessionOrigin,
} from "../../core/session/session.repository.js";
import { accountKey, claimAttempt, clearFailures } from "../../core/throttle/throttle.js";
import * as queries from "./users.queries.js";
import * as repo from "./users.repository.js";

const INVITATION_TTL_MS = 72 * 60 * 60 * 1_000;
const INVITATION_EXPIRED = "Запрошення застаріло. Попросіть надіслати нове";
const WRONG_PASSWORD = "Неправильний пароль";

const ALREADY_THERE: Record<UserStatus, { code: string; message: string }> = {
  invited: { code: "user_already_invited", message: "Цього користувача вже запрошено. Надішліть запрошення повторно" },
  active: { code: "user_already_active", message: "Користувач із таким email уже працює в системі" },
  blocked: { code: "user_blocked", message: "Цього користувача заблоковано. Розблокуйте його в списку" },
};

function alreadyThere(status: UserStatus): AppError {
  const { code, message } = ALREADY_THERE[status];
  return new AppError(409, code, message, { email: message });
}

function notFound(): AppError {
  return new AppError(404, "not_found", "Не знайдено");
}

export function tooManyAttempts(seconds: number): AppError {
  return new AppError(429, "too_many_attempts", `Забагато спроб. Спробуйте через ${seconds} секунд`);
}

// D12: a person who asked for the link, no SMTP yet or a failed letter all end in the link for manual passing
export async function deliverLink(
  deps: AppDeps,
  link: string,
  letter: MailMessage,
  wantsEmail: boolean,
): Promise<LinkDelivery> {
  if (!wantsEmail || !deps.mailer.isConfigured) return { delivery: LINK_DELIVERY.manual, link };
  try {
    await deps.mailer.send(letter);
    return { delivery: LINK_DELIVERY.email };
  } catch (error) {
    deps.logger.error({ err: error }, "letter was not sent, the link is shown instead");
    return { delivery: LINK_DELIVERY.manual, link };
  }
}

function invitationLink(deps: AppDeps, token: string): string {
  return `${deps.config.appUrl}/invite#token=${token}`;
}

async function issueInvitation(db: DbOrTx, userId: string, createdBy: string | null): Promise<string> {
  const { raw, hash } = generateToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await repo.createAuthToken(db, { userId, type: "invitation", tokenHash: hash, expiresAt, createdBy });
  return raw;
}

function actorIdOf(context: ActivityContext): string | null {
  return context.actor.kind === "user" ? context.actor.id : null;
}

export const listUsers = queries.listUsers;

export async function inviteUser(
  deps: AppDeps,
  context: ActivityContext,
  input: InvitationInput,
): Promise<LinkDelivery> {
  const existing = await repo.findUserByEmail(deps.db, input.email);
  if (existing) throw alreadyThere(existing.status);
  const token = await deps.db
    .$transaction(async (tx) => {
      const createdBy = actorIdOf(context);
      const { id } = await repo.createUser(tx, { ...input, status: "invited", passwordHash: null, createdBy });
      await recordActivity(tx, context, {
        action: "user.invited",
        entityType: "user",
        entityId: id,
        details: { roleKey: input.roleKey },
        retentionClass: "security",
      });
      return issueInvitation(tx, id, createdBy);
    })
    .catch((error: unknown) => {
      // Two people inviting one address: the unique index decides, and the slower one hears what the check above says
      throw isUniqueViolation(error) ? alreadyThere(USER_STATUS.invited) : error;
    });
  const link = invitationLink(deps, token);
  return deliverLink(deps, link, invitationLetter(input.email, input.fullName, link), true);
}

// П2: a new invitation cancels the previous one
export async function reinviteUser(
  deps: AppDeps,
  context: ActivityContext,
  id: string,
  input: ReinviteInput,
): Promise<LinkDelivery> {
  const { user, token } = await deps.db.$transaction(async (tx) => {
    await repo.lockUsers(tx, [id]);
    const user = await repo.findUserById(tx, id);
    if (!user) throw notFound();
    if (user.status !== USER_STATUS.invited) {
      throw new AppError(409, "user_not_invited", "Цей користувач уже прийняв запрошення");
    }
    await repo.revokeUserTokens(tx, id, ["invitation"]);
    await recordActivity(tx, context, {
      action: "user.invited",
      entityType: "user",
      entityId: id,
      details: { repeated: true },
      retentionClass: "security",
    });
    return { user, token: await issueInvitation(tx, id, actorIdOf(context)) };
  });
  const link = invitationLink(deps, token);
  return deliverLink(deps, link, invitationLetter(user.email, user.fullName, link), input.sendEmail);
}

export async function acceptInvitation(
  deps: AppDeps,
  input: InvitationAccept,
  origin: SessionOrigin,
  requestId: string,
): Promise<NewSession> {
  const expired = new AppError(410, "invitation_expired", INVITATION_EXPIRED);
  const token = await repo.findLiveToken(deps.db, hashToken(input.token), "invitation");
  if (!token) throw expired;
  const user = await repo.findUserById(deps.db, token.userId);
  if (user?.status !== USER_STATUS.invited) throw expired;
  assertStrongPassword(input.password, [user.email, user.fullName]);
  // Hashed before the transaction: it takes tens of milliseconds and must not hold a connection
  const passwordHash = await hashPassword(input.password);

  return deps.db.$transaction(async (tx) => {
    await repo.lockUsers(tx, [user.id]);
    if (!(await repo.consumeToken(tx, token.id))) throw expired;
    await repo.activateUser(tx, user.id, passwordHash);
    await recordActivity(
      tx,
      { actor: { kind: "user", id: user.id }, ip: origin.ip, requestId },
      { action: "user.invitation_accepted", entityType: "user", entityId: user.id, retentionClass: "security" },
    );
    // A session held at the 2FA setup: the password alone opens nothing (К2)
    return createSession(tx, user.id, origin);
  });
}

// Blocking ends every session, so the next request of that person lands on the login page (П6, §11). Nobody blocks
// themselves, and both rows are locked: two people blocking each other at once must leave one active, not none.
export async function blockUser(deps: AppDeps, context: ActivityContext, id: string): Promise<void> {
  const actorId = actorIdOf(context);
  if (id === actorId) throw new AppError(409, "cannot_block_self", "Не можна заблокувати власний обліковий запис");
  await deps.db.$transaction(async (tx) => {
    await repo.lockUsers(tx, actorId ? [actorId, id] : [id]);
    const actor = actorId ? await repo.findUserById(tx, actorId) : null;
    if (actorId && actor?.status !== USER_STATUS.active) {
      throw new AppError(409, "actor_not_active", "Ваш обліковий запис заблоковано");
    }
    const user = await repo.findUserById(tx, id);
    if (!user) throw notFound();
    if (user.status === USER_STATUS.blocked) return;
    await repo.changeStatus(tx, id, USER_STATUS.blocked, actorId);
    await deleteAllUserSessions(tx, id);
    await repo.revokeUserTokens(tx, id);
    await recordActivity(tx, context, {
      action: "user.blocked",
      entityType: "user",
      entityId: id,
      changes: { status: [user.status, USER_STATUS.blocked] },
      retentionClass: "security",
    });
  });
}

// Whoever had no password yet goes back to invited: their invitation died with the block, so it takes a new one. A
// sign-in or a link that slipped in around the block sits dead until now, and must not wake up with the person.
export async function unblockUser(deps: AppDeps, context: ActivityContext, id: string): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    await repo.lockUsers(tx, [id]);
    const user = await repo.findUserById(tx, id);
    if (!user) throw notFound();
    if (user.status !== USER_STATUS.blocked) return;
    const status = user.passwordHash ? USER_STATUS.active : USER_STATUS.invited;
    await repo.changeStatus(tx, id, status, actorIdOf(context));
    await deleteAllUserSessions(tx, id);
    await repo.revokeUserTokens(tx, id);
    await recordActivity(tx, context, {
      action: "user.unblocked",
      entityType: "user",
      entityId: id,
      changes: { status: [USER_STATUS.blocked, status] },
      retentionClass: "security",
    });
  });
}

export function toCurrentUser(auth: AuthContext): CurrentUser {
  return {
    id: auth.userId,
    email: auth.email,
    fullName: auth.fullName,
    roleKey: auth.roleKey,
    twoFactorEnabled: auth.twoFactorEnabled,
  };
}

export async function updateProfile(
  deps: AppDeps,
  context: ActivityContext,
  auth: AuthContext,
  input: ProfileUpdate,
): Promise<CurrentUser> {
  if (input.fullName !== auth.fullName) {
    await deps.db.$transaction(async (tx) => {
      await repo.updateFullName(tx, auth.userId, input.fullName);
      await recordActivity(tx, context, {
        action: "user.profile_updated",
        entityType: "user",
        entityId: auth.userId,
        changes: { fullName: [auth.fullName, input.fullName] },
      });
    });
  }
  return { ...toCurrentUser(auth), fullName: input.fullName };
}

// A password asked again before something sensitive. It shares the account's counter with the login page: a guess is
// a guess wherever it is typed.
export async function confirmPassword(deps: AppDeps, userId: string, email: string, password: string): Promise<void> {
  const key = accountKey(email);
  const wait = await claimAttempt(deps.db, [key]);
  if (wait > 0) throw tooManyAttempts(wait);
  const user = await repo.findUserById(deps.db, userId);
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
    throw new AppError(422, "wrong_password", WRONG_PASSWORD, { password: WRONG_PASSWORD });
  }
  await clearFailures(deps.db, [key]);
}

// П1. Only on an empty table, so a value left in .env can neither reset a password nor add a second account
export async function ensureFirstAdmin(
  deps: Pick<AppDeps, "db">,
  input: { email: string; fullName: string; password: string },
): Promise<boolean> {
  if ((await repo.countUsers(deps.db)) > 0) return false;
  assertStrongPassword(input.password, [input.email, input.fullName]);
  const passwordHash = await hashPassword(input.password);
  return deps.db.$transaction(async (tx) => {
    await repo.lockFirstAdminCreation(tx);
    if ((await repo.countUsers(tx)) > 0) return false;
    const { id } = await repo.createUser(tx, {
      email: input.email,
      fullName: input.fullName,
      roleKey: "admin",
      status: "active",
      passwordHash,
      createdBy: null,
    });
    await recordActivity(
      tx,
      { actor: SYSTEM_ACTOR, ip: null, requestId: null },
      { action: "user.first_admin_created", entityType: "user", entityId: id, retentionClass: "security" },
    );
    return true;
  });
}
