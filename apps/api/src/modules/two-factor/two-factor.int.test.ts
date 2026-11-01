import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { NO_MAIL, testConfig } from "../../core/test-app.js";
import {
  api,
  clearAuthData,
  createUser,
  loginPassword,
  sessionCookieOf,
  signInWithSetup,
  STRONG_PASSWORD,
  totpCode,
} from "../../test-auth.js";
import { savePendingSecret } from "./two-factor.repository.js";

describe("two-factor", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let app: FastifyInstance;

  beforeEach(async () => {
    await clearAuthData(owner);
    app = await buildApp({ db, config: testConfig(), mailer: NO_MAIL, checkReady: () => Promise.resolve() });
  });

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  it("keeps the secret sealed and draws the QR itself", async () => {
    const user = await createUser(owner, { email: "qr@example.test" });
    const held = sessionCookieOf(await loginPassword(app, user.email));

    const setup = await api(app, "POST", "/me/2fa/setup", { cookie: held });

    const { secret, qrDataUrl } = setup.json<{ secret: string; qrDataUrl: string }>();
    expect(qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const stored = await owner.twoFactorCredential.findUniqueOrThrow({ where: { userId: user.id } });
    expect(stored.secretEncrypted).not.toContain(secret);
    expect(stored.confirmedAt).toBeNull();
  });

  it("does not switch on with a wrong code, and counts it", async () => {
    const user = await createUser(owner, { email: "wrong@example.test" });
    const held = sessionCookieOf(await loginPassword(app, user.email));
    await api(app, "POST", "/me/2fa/setup", { cookie: held });

    const answer = await api(app, "POST", "/me/2fa/confirm", { cookie: held, payload: { code: "000000" } });

    expect(answer.statusCode).toBe(401);
    expect(answer.json()).toMatchObject({ message: "Код не підходить. Перевірте час на телефоні" });
    const credential = await owner.twoFactorCredential.findUniqueOrThrow({ where: { userId: user.id } });
    expect(credential.confirmedAt).toBeNull();
    expect(await owner.signInThrottle.count({ where: { key: `2fa:${user.id}` } })).toBe(1);
  });

  it("ends what was open under the password alone and issues a new session", async () => {
    const user = await createUser(owner, { email: "rotate@example.test" });
    const held = sessionCookieOf(await loginPassword(app, user.email));
    const parallel = sessionCookieOf(await loginPassword(app, user.email));
    await api(app, "POST", "/me/2fa/setup", { cookie: held });

    const code = await totpCode(owner, user.id);
    const confirmed = await api(app, "POST", "/me/2fa/confirm", { cookie: held, payload: { code } });

    const fresh = sessionCookieOf(confirmed);
    expect(fresh).not.toBe(held);
    expect((await api(app, "GET", "/me", { cookie: held })).statusCode).toBe(401);
    expect((await api(app, "GET", "/me", { cookie: parallel })).statusCode).toBe(401);
    expect((await api(app, "GET", "/me", { cookie: fresh })).json()).toMatchObject({ twoFactorEnabled: true });
  });

  it("does not write a new secret over one that is on", async () => {
    const user = await createUser(owner, { email: "second-tab@example.test" });
    await signInWithSetup(app, owner, user);
    const before = await owner.twoFactorCredential.findUniqueOrThrow({ where: { userId: user.id } });

    expect(await savePendingSecret(db, user.id, "another secret")).toBe(false);

    const after = await owner.twoFactorCredential.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.secretEncrypted).toBe(before.secretEncrypted);
  });

  it("refuses a second setup", async () => {
    const user = await createUser(owner, { email: "twice@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);

    expect((await api(app, "POST", "/me/2fa/setup", { cookie })).statusCode).toBe(409);
  });

  it("replaces the recovery codes behind the password", async () => {
    const user = await createUser(owner, { email: "codes@example.test" });
    const { cookie, recoveryCodes } = await signInWithSetup(app, owner, user);

    const wrong = await api(app, "POST", "/me/2fa/recovery-codes", { cookie, payload: { password: "неправильний" } });
    expect(wrong.statusCode).toBe(422);

    const fresh = await api(app, "POST", "/me/2fa/recovery-codes", { cookie, payload: { password: STRONG_PASSWORD } });
    const next = fresh.json<{ recoveryCodes: string[] }>().recoveryCodes;
    expect(next).toHaveLength(10);
    expect(next).not.toContain(recoveryCodes[0]);

    const login = await loginPassword(app, user.email);
    const challenge = login.json<{ challenge: string }>().challenge;
    const old = await api(app, "POST", "/auth/2fa", { payload: { challenge, code: recoveryCodes[0] } });
    expect(old.statusCode).toBe(401);
  });

  it("resets a colleague's 2FA with the actor's password, ends the sessions, and journals it", async () => {
    const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    const user = await createUser(owner, { email: "phone-lost@example.test" });
    const { cookie } = await signInWithSetup(app, owner, admin);
    const { cookie: userCookie } = await signInWithSetup(app, owner, user);
    await owner.authToken.create({
      data: { userId: user.id, type: "password_reset", tokenHash: "x", expiresAt: new Date(Date.now() + 60_000) },
    });

    const wrong = await api(app, "POST", `/users/${user.id}/reset-2fa`, {
      cookie,
      payload: { password: "неправильний" },
    });
    expect(wrong.statusCode).toBe(422);
    expect(await owner.twoFactorCredential.count({ where: { userId: user.id } })).toBe(1);

    const reset = await api(app, "POST", `/users/${user.id}/reset-2fa`, {
      cookie,
      payload: { password: STRONG_PASSWORD },
    });
    expect(reset.statusCode).toBe(204);
    expect(await owner.authToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
    expect((await api(app, "GET", "/me", { cookie: userCookie })).statusCode).toBe(401);
    expect((await loginPassword(app, user.email)).json()).toMatchObject({ status: "two_factor_setup_required" });
    const event = await owner.activityEvent.findFirstOrThrow({ where: { action: "two_factor.reset" } });
    expect(event).toMatchObject({ actorId: admin.id, entityId: user.id });
  });

  it("does not reset one's own 2FA, so a stolen session cannot remove it", async () => {
    const admin = await createUser(owner, { email: "self@example.test", roleKey: "admin" });
    const { cookie } = await signInWithSetup(app, owner, admin);

    const answer = await api(app, "POST", `/users/${admin.id}/reset-2fa`, {
      cookie,
      payload: { password: STRONG_PASSWORD },
    });

    expect(answer.statusCode).toBe(409);
    expect(await owner.twoFactorCredential.count({ where: { userId: admin.id } })).toBe(1);
  });

  it("answers 404 and 409 for a reset with nothing to reset", async () => {
    const admin = await createUser(owner, { email: "a@example.test", roleKey: "admin" });
    const plain = await createUser(owner, { email: "plain@example.test" });
    const { cookie } = await signInWithSetup(app, owner, admin);
    const payload = { password: STRONG_PASSWORD };

    expect(
      (await api(app, "POST", "/users/019a0000-0000-7000-8000-000000000000/reset-2fa", { cookie, payload })).statusCode,
    ).toBe(404);
    expect((await api(app, "POST", `/users/${plain.id}/reset-2fa`, { cookie, payload })).statusCode).toBe(409);
  });
});
