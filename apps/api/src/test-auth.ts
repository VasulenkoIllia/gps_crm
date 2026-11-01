import type { RoleKey } from "@gps_crm/shared";
import { LOGIN_STATUS } from "@gps_crm/shared";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { base32Decode, hotp, stepAt } from "./modules/two-factor/index.js";
import { hashPassword } from "./core/crypto/passwords.js";
import { openSecret } from "./core/crypto/secrets.js";
import type { DbClient } from "./core/db/client.js";
import { clearClientData } from "./core/db/test-database.js";
import { API_PREFIX } from "./core/deps.js";
import { testConfig } from "./core/test-app.js";

export const STRONG_PASSWORD = "довгий пароль для тестів";
export const NEW_PASSWORD = "інший довгий пароль тесту";

const SESSION_COOKIE = "session";
const TOTP_STEP_MS = 30_000;

// Dependents first: nothing here cascades, on purpose
export async function clearAuthData(ownerDb: DbClient): Promise<void> {
  await clearClientData(ownerDb);
  await ownerDb.activityEvent.deleteMany();
  await ownerDb.twoFactorCredential.deleteMany();
  await ownerDb.session.deleteMany();
  await ownerDb.authToken.deleteMany();
  await ownerDb.signInThrottle.deleteMany();
  await ownerDb.user.deleteMany();
}

export async function createUser(
  ownerDb: DbClient,
  input: { email: string; roleKey?: RoleKey; status?: "invited" | "active" | "blocked"; hasPassword?: boolean },
): Promise<{ id: string; email: string }> {
  const passwordHash = input.hasPassword === false ? null : await hashPassword(STRONG_PASSWORD);
  return ownerDb.user.create({
    data: {
      email: input.email,
      fullName: `Користувач ${input.email}`,
      status: input.status ?? "active",
      passwordHash,
      role: { connect: { key: input.roleKey ?? "manager" } },
    },
    select: { id: true, email: true },
  });
}

export function sessionCookieOf(response: LightMyRequestResponse): string {
  const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE);
  if (!cookie) throw new Error(`no session cookie, status ${response.statusCode}: ${response.body}`);
  return cookie.value;
}

export function api(
  app: FastifyInstance,
  method: NonNullable<InjectOptions["method"]>,
  path: string,
  options: { cookie?: string; payload?: InjectOptions["payload"]; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url: `${API_PREFIX}${path}`,
    headers: options.headers,
    payload: options.payload,
    ...(options.cookie ? { cookies: { [SESSION_COOKIE]: options.cookie } } : {}),
  });
}

export async function totpCode(ownerDb: DbClient, userId: string, offsetSteps = 0): Promise<string> {
  const credential = await ownerDb.twoFactorCredential.findUniqueOrThrow({ where: { userId } });
  const secret = openSecret(testConfig().secretsKey, credential.secretEncrypted, userId);
  return hotp(base32Decode(secret), stepAt(Date.now() + offsetSteps * TOTP_STEP_MS));
}

export async function loginPassword(app: FastifyInstance, email: string, password = STRONG_PASSWORD) {
  return api(app, "POST", "/auth/login", { payload: { email, password } });
}

// A full account: password, then the mandatory setup of 2FA. Returns the session and the recovery codes.
export async function signInWithSetup(
  app: FastifyInstance,
  ownerDb: DbClient,
  user: { id: string; email: string },
): Promise<{ cookie: string; recoveryCodes: string[] }> {
  const login = await loginPassword(app, user.email);
  if (login.json<{ status: string }>().status !== LOGIN_STATUS.twoFactorSetupRequired) {
    throw new Error(`expected a setup, got: ${login.body}`);
  }
  const held = sessionCookieOf(login);
  await api(app, "POST", "/me/2fa/setup", { cookie: held });
  const code = await totpCode(ownerDb, user.id);
  const confirmed = await api(app, "POST", "/me/2fa/confirm", { cookie: held, payload: { code } });
  return {
    cookie: sessionCookieOf(confirmed),
    recoveryCodes: confirmed.json<{ recoveryCodes: string[] }>().recoveryCodes,
  };
}

// The step a code was already spent on can be taken back, so a test can log in twice within 30 seconds
export async function rewindTotp(ownerDb: DbClient, userId: string): Promise<void> {
  await ownerDb.twoFactorCredential.update({ where: { userId }, data: { lastStep: null } });
}
