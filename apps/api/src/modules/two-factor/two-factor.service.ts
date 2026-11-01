import { USER_STATUS, type TwoFactorLoginInput, type TwoFactorSetup } from "@gps_crm/shared";
import { renderSVG } from "uqr";
import { recordActivity, type ActivityContext } from "../../core/activity/activity.repository.js";
import { openSecret, sealSecret } from "../../core/crypto/secrets.js";
import { generateToken, hashToken } from "../../core/crypto/tokens.js";
import type { DbOrTx } from "../../core/db/client.js";
import { APP_TITLE, type AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import type { AuthContext } from "../../core/session/session.queries.js";
import {
  createSession,
  deleteAllUserSessions,
  type NewSession,
  type SessionOrigin,
} from "../../core/session/session.repository.js";
import { claimAttempt, clearFailures, secondFactorKey } from "../../core/throttle/throttle.js";
import {
  claimTokenAttempt,
  confirmPassword,
  consumeToken,
  createAuthToken,
  findLiveToken,
  findUserById,
  lockUsers,
  revokeUserTokens,
  tooManyAttempts,
} from "../users/index.js";
import { generateRecoveryCodes, hashRecoveryCode, isRecoveryCodeShape } from "./recovery-codes.js";
import { generateTotpSecret, matchStep, otpauthUri } from "./totp.js";
import * as repo from "./two-factor.repository.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const CHALLENGE_ATTEMPTS = 5;
const WRONG_CODE = "Код не підходить. Перевірте час на телефоні";
const CHALLENGE_EXPIRED = "Час входу минув. Введіть пароль ще раз";
const ALREADY_ON = "Двофакторний вхід уже налаштовано";

function readSecret(deps: AppDeps, credential: { userId: string; secretEncrypted: string }): string | null {
  try {
    return openSecret(deps.config.secretsKey, credential.secretEncrypted, credential.userId);
  } catch (error) {
    // A restore paired with the wrong .env, not a wrong code: recovery codes still work (RESTORE.md)
    deps.logger.error({ err: error }, "a 2FA secret does not open: is SECRETS_KEY the one that sealed it?");
    return null;
  }
}

function qrDataUrl(uri: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(renderSVG(uri)).toString("base64")}`;
}

// Nothing is on until a code from the phone confirms it, so a person cannot lock themselves out on the first day
export async function beginSetup(deps: AppDeps, auth: AuthContext): Promise<TwoFactorSetup> {
  const existing = await repo.findCredential(deps.db, auth.userId);
  if (existing?.confirmedAt) throw new AppError(409, "two_factor_already_on", ALREADY_ON);
  const secret = generateTotpSecret();
  const sealed = sealSecret(deps.config.secretsKey, secret, auth.userId);
  if (!(await repo.savePendingSecret(deps.db, auth.userId, sealed))) {
    throw new AppError(409, "two_factor_already_on", ALREADY_ON);
  }
  return { secret, qrDataUrl: qrDataUrl(otpauthUri(APP_TITLE, auth.email, secret)) };
}

function wrongCode(): AppError {
  return new AppError(401, "invalid_code", WRONG_CODE, { code: WRONG_CODE });
}

function challengeExpired(): AppError {
  return new AppError(401, "challenge_expired", CHALLENGE_EXPIRED);
}

async function takeCodeAttempt(deps: AppDeps, userId: string): Promise<void> {
  const wait = await claimAttempt(deps.db, [secondFactorKey(userId)]);
  if (wait > 0) throw tooManyAttempts(wait);
}

// Ends every other session and issues a new one: whatever was open under the password alone stops here
export async function confirmSetup(
  deps: AppDeps,
  context: ActivityContext,
  auth: AuthContext,
  code: string,
  origin: SessionOrigin,
): Promise<{ recoveryCodes: string[]; session: NewSession }> {
  const credential = await repo.findCredential(deps.db, auth.userId);
  if (!credential) throw new AppError(409, "two_factor_not_started", "Спершу почніть налаштування");
  if (credential.confirmedAt) throw new AppError(409, "two_factor_already_on", ALREADY_ON);
  await takeCodeAttempt(deps, auth.userId);
  const secret = readSecret(deps, credential);
  const step = secret === null ? null : matchStep(secret, code, Date.now());
  if (step === null) throw wrongCode();

  const recoveryCodes = generateRecoveryCodes();
  const session = await deps.db.$transaction(async (tx) => {
    await lockUsers(tx, [auth.userId]);
    if (!(await repo.confirmCredential(tx, credential, step))) {
      throw new AppError(409, "two_factor_already_on", ALREADY_ON);
    }
    await repo.replaceRecoveryCodes(tx, credential.id, recoveryCodes.map(hashRecoveryCode));
    await deleteAllUserSessions(tx, auth.userId);
    await clearFailures(tx, [secondFactorKey(auth.userId)]);
    await recordActivity(tx, context, {
      action: "two_factor.enabled",
      entityType: "user",
      entityId: auth.userId,
      retentionClass: "security",
    });
    return createSession(tx, auth.userId, origin);
  });
  return { recoveryCodes, session };
}

export async function regenerateRecoveryCodes(
  deps: AppDeps,
  context: ActivityContext,
  auth: AuthContext,
  password: string,
): Promise<string[]> {
  await confirmPassword(deps, auth.userId, auth.email, password);
  const credential = await repo.findCredential(deps.db, auth.userId);
  if (!credential?.confirmedAt) throw new AppError(409, "two_factor_not_on", "Двофакторний вхід ще не налаштовано");
  const recoveryCodes = generateRecoveryCodes();
  await deps.db.$transaction(async (tx) => {
    await repo.replaceRecoveryCodes(tx, credential.id, recoveryCodes.map(hashRecoveryCode));
    await recordActivity(tx, context, {
      action: "two_factor.recovery_codes_regenerated",
      entityType: "user",
      entityId: auth.userId,
      retentionClass: "security",
    });
  });
  return recoveryCodes;
}

// П8. Not on one's own account: a stolen session must not remove the one thing in its way
export async function resetForUser(
  deps: AppDeps,
  context: ActivityContext,
  auth: AuthContext,
  targetId: string,
  password: string,
): Promise<void> {
  if (targetId === auth.userId) {
    throw new AppError(409, "cannot_reset_own_two_factor", "Власну двофакторну перевірку скидає інший користувач");
  }
  await confirmPassword(deps, auth.userId, auth.email, password);
  if (!(await findUserById(deps.db, targetId))) throw new AppError(404, "not_found", "Не знайдено");
  await deps.db.$transaction(async (tx) => {
    await lockUsers(tx, [targetId]);
    if (!(await repo.deleteCredential(tx, targetId))) {
      throw new AppError(409, "two_factor_not_on", "У цього користувача двофакторний вхід не налаштовано");
    }
    await deleteAllUserSessions(tx, targetId);
    // A live reset link next to a fresh setup of 2FA would be a way in for whoever holds the mailbox
    await revokeUserTokens(tx, targetId, ["two_factor_challenge", "password_reset"]);
    await clearFailures(tx, [secondFactorKey(targetId)]);
    await recordActivity(tx, context, {
      action: "two_factor.reset",
      entityType: "user",
      entityId: targetId,
      retentionClass: "security",
    });
  });
}

// A challenge when the account has 2FA, null when it has yet to set it up. A new one closes any older, so the caller
// holds the user's row: parallel sign-ins must not leave several challenges, each with its own five tries.
export async function startChallenge(db: DbOrTx, userId: string): Promise<string | null> {
  const credential = await repo.findCredential(db, userId);
  if (!credential?.confirmedAt) return null;
  await revokeUserTokens(db, userId, ["two_factor_challenge"]);
  const { raw, hash } = generateToken();
  await createAuthToken(db, {
    userId,
    type: "two_factor_challenge",
    tokenHash: hash,
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    createdBy: null,
  });
  return raw;
}

interface Attempt {
  deps: AppDeps;
  context: ActivityContext;
  credential: { id: string; userId: string; secretEncrypted: string };
  challengeId: string;
  userId: string;
  code: string;
}

// Code, challenge and journal together: a spent code with no trace of it would be a security event nobody can see
async function spendRecoveryCode({ deps, context, credential, challengeId, userId, code }: Attempt): Promise<boolean> {
  return deps.db.$transaction(async (tx) => {
    if (!(await repo.consumeRecoveryCode(tx, credential.id, hashRecoveryCode(code)))) return false;
    // Thrown, not returned: the rollback gives back a code spent on a challenge that closed in the meantime
    if (!(await consumeToken(tx, challengeId))) throw challengeExpired();
    await recordActivity(tx, context, {
      action: "two_factor.recovery_code_used",
      entityType: "user",
      entityId: userId,
      details: { codesLeft: await repo.countUnusedRecoveryCodes(tx, credential.id) },
      retentionClass: "security",
    });
    return true;
  });
}

async function spendAppCode({ deps, credential, challengeId, code }: Attempt): Promise<boolean> {
  const secret = readSecret(deps, credential);
  const step = secret === null ? null : matchStep(secret, code, Date.now());
  // Fresh by the clock and unspent in the database: only the conditional write can say both (П7)
  if (step === null || !(await repo.advanceStep(deps.db, credential.id, step))) return false;
  if (!(await consumeToken(deps.db, challengeId))) throw challengeExpired();
  return true;
}

// The second step: the person, once the code is right. The route opens the session.
export async function completeChallenge(
  deps: AppDeps,
  context: ActivityContext,
  input: TwoFactorLoginInput,
): Promise<{ userId: string; email: string }> {
  const challenge = await findLiveToken(deps.db, hashToken(input.challenge), "two_factor_challenge");
  if (!challenge) throw challengeExpired();
  const user = await findUserById(deps.db, challenge.userId);
  const credential = await repo.findCredential(deps.db, challenge.userId);
  if (user?.status !== USER_STATUS.active || !credential?.confirmedAt) throw challengeExpired();

  await takeCodeAttempt(deps, user.id);
  if (!(await claimTokenAttempt(deps.db, challenge.id, CHALLENGE_ATTEMPTS))) {
    await consumeToken(deps.db, challenge.id);
    throw challengeExpired();
  }
  const attempt = { deps, context, credential, challengeId: challenge.id, userId: user.id, code: input.code };
  const isAccepted = await (isRecoveryCodeShape(input.code) ? spendRecoveryCode(attempt) : spendAppCode(attempt));
  if (!isAccepted) {
    await recordActivity(deps.db, context, {
      action: "auth.login_failed",
      entityType: "user",
      entityId: user.id,
      details: { reason: "wrong_code" },
      retentionClass: "security",
    });
    throw wrongCode();
  }
  return { userId: user.id, email: user.email };
}
