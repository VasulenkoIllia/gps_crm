import { LOGIN_STATUS } from "@gps_crm/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_ACTOR } from "../../core/activity/activity.repository.js";
import { buildApp } from "../../app.js";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import {
  captureMailer,
  NO_MAIL,
  TEST_APP_URL,
  testConfig,
  type CapturingMailer,
  NO_FILES,
  NO_JOBS,
} from "../../core/test-app.js";
import {
  api,
  clearAuthData,
  createUser,
  loginPassword,
  NEW_PASSWORD,
  rewindTotp,
  sessionCookieOf,
  signInWithSetup,
  STRONG_PASSWORD,
  totpCode,
} from "../../test-auth.js";
import { lockUsers } from "../users/index.js";
import { requestPasswordReset } from "./auth.service.js";
import { runAuthCleanup } from "./index.js";

const FORWARDED = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "173.245.48.1" };
const WAVE_SIZE = 12;
const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;

function signInStandsWaiting(owner: DbClient): Promise<void> {
  return vi.waitFor(async () => {
    const [row] = await owner.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    expect(row?.waiting).toBeGreaterThan(0n);
  });
}

const countOf = (answers: { statusCode: number }[], statusCode: number) =>
  answers.filter((answer) => answer.statusCode === statusCode).length;

describe("sign-in", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let app: FastifyInstance;
  let mailer: CapturingMailer;

  beforeEach(async () => {
    await clearAuthData(owner);
    mailer = captureMailer();
    app = await buildApp({ db, config: testConfig(), mailer, jobs: NO_JOBS, checkReady: () => Promise.resolve() });
  });

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  it("holds a password-only account at the setup of 2FA, with no way to the data", async () => {
    await createUser(owner, { email: "new@example.test" });

    const login = await loginPassword(app, "new@example.test");

    expect(login.json()).toEqual({ status: LOGIN_STATUS.twoFactorSetupRequired });
    const cookie = sessionCookieOf(login);
    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(200);
    const denied = await api(app, "GET", "/users", { cookie });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "two_factor_required" });
    expect((await api(app, "GET", "/me/sessions", { cookie })).statusCode).toBe(403);
  });

  it("signs in with a code, spends the code once, and records it", async () => {
    const user = await createUser(owner, { email: "two@example.test" });
    await signInWithSetup(app, owner, user);
    await rewindTotp(owner, user.id);

    const first = await loginPassword(app, user.email);
    expect(first.json()).toMatchObject({ status: LOGIN_STATUS.twoFactorRequired });
    expect(first.cookies).toEqual([]);
    const { challenge } = first.json<{ challenge: string }>();
    const code = await totpCode(owner, user.id);
    const second = await api(app, "POST", "/auth/2fa", { payload: { challenge, code } });
    expect(second.json()).toEqual({ status: LOGIN_STATUS.signedIn });
    const cookie = sessionCookieOf(second);
    expect((await api(app, "GET", "/users", { cookie })).statusCode).toBe(200);

    const again = await loginPassword(app, user.email);
    const reused = await api(app, "POST", "/auth/2fa", {
      payload: { challenge: again.json<{ challenge: string }>().challenge, code },
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({ code: "invalid_code" });

    const actions = (await owner.activityEvent.findMany({ orderBy: { occurredAt: "asc" } })).map((row) => row.action);
    expect(actions).toEqual(expect.arrayContaining(["auth.login", "two_factor.enabled", "auth.login_failed"]));
    const withoutSecret = await owner.activityEvent.findMany({ where: { action: "auth.login" } });
    expect(JSON.stringify(withoutSecret)).not.toContain(STRONG_PASSWORD);
  });

  it("gives every failed sign-in the same answer", async () => {
    await createUser(owner, { email: "blocked@example.test", status: "blocked" });
    await createUser(owner, { email: "invited@example.test", status: "invited", hasPassword: false });
    await createUser(owner, { email: "real@example.test" });

    const answers = await Promise.all([
      loginPassword(app, "nobody@example.test"),
      loginPassword(app, "blocked@example.test"),
      loginPassword(app, "invited@example.test", "будь-який пароль"),
      loginPassword(app, "real@example.test", "неправильний пароль"),
    ]);

    expect(new Set(answers.map((answer) => answer.statusCode))).toEqual(new Set([401]));
    expect(new Set(answers.map((answer) => answer.body)).size).toBe(1);
    expect(answers[0]?.json()).toEqual({ code: "invalid_credentials", message: "Неправильний email або пароль" });
  });

  it("pauses after a run of failures, on the email and whatever the address, and only by a wait", async () => {
    await createUser(owner, { email: "target@example.test" });
    for (let failure = 0; failure < 5; failure += 1) {
      await loginPassword(app, "target@example.test", "неправильний пароль");
    }

    const paused = await loginPassword(app, "TARGET@example.test");
    expect(paused.statusCode).toBe(429);
    expect(paused.json<{ message: string }>().message).toMatch(/^Забагато спроб\. Спробуйте через \d+ секунд$/);

    await owner.signInThrottle.updateMany({ data: { lastFailureAt: new Date(Date.now() - 16 * 60 * 1_000) } });
    expect((await loginPassword(app, "target@example.test")).statusCode).toBe(200);
  });

  it("gives a parallel wave of wrong passwords no more tries than one by one", async () => {
    await createUser(owner, { email: "wave@example.test" });

    const answers = await Promise.all(
      Array.from({ length: WAVE_SIZE }, () => loginPassword(app, "wave@example.test", "неправильний пароль")),
    );

    expect(countOf(answers, 401)).toBe(5);
    expect(countOf(answers, 429)).toBe(WAVE_SIZE - 5);
  });

  it("gives a parallel wave of wrong codes no more tries than one by one", async () => {
    const user = await createUser(owner, { email: "codes@example.test" });
    await signInWithSetup(app, owner, user);
    const { challenge } = (await loginPassword(app, user.email)).json<{ challenge: string }>();

    const answers = await Promise.all(
      Array.from({ length: WAVE_SIZE }, () =>
        api(app, "POST", "/auth/2fa", { payload: { challenge, code: "000000" } }),
      ),
    );

    expect(countOf(answers, 401)).toBe(5);
    expect(countOf(answers, 429)).toBe(WAVE_SIZE - 5);
  });

  it("leaves one live challenge after parallel sign-ins, each challenge being five more tries", async () => {
    const user = await createUser(owner, { email: "parallel@example.test" });
    await signInWithSetup(app, owner, user);

    await Promise.all(Array.from({ length: 4 }, () => loginPassword(app, user.email)));

    const live = { userId: user.id, type: "two_factor_challenge" as const, usedAt: null };
    expect(await owner.authToken.count({ where: live })).toBe(1);
  });

  it("gives no password-only session past the moment 2FA goes on", async () => {
    const user = await createUser(owner, { email: "race@example.test" });

    // The order of confirmSetup: the row taken, then 2FA on, held until the sign-in stands waiting for the row
    const { pending } = await owner.$transaction(async (tx) => {
      await lockUsers(tx, [user.id]);
      await tx.twoFactorCredential.create({
        data: { userId: user.id, secretEncrypted: "sealed", confirmedAt: new Date() },
      });
      const signIn = loginPassword(app, user.email);
      await signInStandsWaiting(owner);
      return { pending: signIn };
    });

    expect((await pending).json()).toMatchObject({ status: LOGIN_STATUS.twoFactorRequired });
    expect(await owner.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("opens nothing with a password changed while it was being checked", async () => {
    const user = await createUser(owner, { email: "stale@example.test" });

    const { pending } = await owner.$transaction(async (tx) => {
      await lockUsers(tx, [user.id]);
      const signIn = loginPassword(app, user.email);
      await signInStandsWaiting(owner);
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: "a newer hash" } });
      return { pending: signIn };
    });

    expect((await pending).json()).toMatchObject({ code: "invalid_credentials" });
    expect(await owner.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("counts an unknown email like a known one, so the pause says nothing either", async () => {
    for (let failure = 0; failure < 5; failure += 1) await loginPassword(app, "ghost@example.test", "щось інше тут");

    expect((await loginPassword(app, "ghost@example.test")).statusCode).toBe(429);
  });

  it("takes the caller's address from Cloudflare only behind Cloudflare", async () => {
    await createUser(owner, { email: "ip@example.test" });

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: FORWARDED,
      payload: { email: "ip@example.test", password: "неправильний пароль" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "cf-connecting-ip": "203.0.113.77" },
      payload: { email: "ip@example.test", password: "неправильний пароль" },
    });

    const events = await owner.activityEvent.findMany({
      where: { action: "auth.login_failed" },
      orderBy: { id: "asc" },
    });
    expect(events.map((event) => event.ip)).toEqual(["203.0.113.9", "127.0.0.1"]);
  });

  it("limits requests per address on top of the per-account pause", async () => {
    const answers = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      answers.push(await loginPassword(app, `flood${attempt}@example.test`));
    }
    expect(answers.at(-2)?.statusCode).toBe(401);
    expect(answers.at(-1)?.statusCode).toBe(429);
    expect(answers.at(-1)?.json()).toMatchObject({ code: "too_many_requests" });
  });

  it("accepts a recovery code once and tells the journal", async () => {
    const user = await createUser(owner, { email: "lost@example.test" });
    const { recoveryCodes } = await signInWithSetup(app, owner, user);
    expect(recoveryCodes).toHaveLength(10);
    const code = recoveryCodes[0] ?? "";

    const login = await loginPassword(app, user.email);
    const challenge = login.json<{ challenge: string }>().challenge;
    const used = await api(app, "POST", "/auth/2fa", { payload: { challenge, code } });
    expect(used.statusCode).toBe(200);

    const again = await loginPassword(app, user.email);
    const repeat = await api(app, "POST", "/auth/2fa", {
      payload: { challenge: again.json<{ challenge: string }>().challenge, code },
    });
    expect(repeat.statusCode).toBe(401);
    expect(await owner.activityEvent.count({ where: { action: "two_factor.recovery_code_used" } })).toBe(1);
  });

  it("closes a challenge after five wrong codes", async () => {
    const user = await createUser(owner, { email: "guess@example.test" });
    await signInWithSetup(app, owner, user);
    const login = await loginPassword(app, user.email);
    const { challenge } = login.json<{ challenge: string }>();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await owner.signInThrottle.deleteMany();
      expect((await api(app, "POST", "/auth/2fa", { payload: { challenge, code: "000000" } })).statusCode).toBe(401);
    }
    await owner.signInThrottle.deleteMany();
    const closed = await api(app, "POST", "/auth/2fa", { payload: { challenge, code: "000000" } });
    expect(closed.json()).toMatchObject({ code: "challenge_expired" });
  });

  it("drops an expired challenge", async () => {
    const user = await createUser(owner, { email: "slow@example.test" });
    await signInWithSetup(app, owner, user);
    const login = await loginPassword(app, user.email);
    await owner.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });

    const late = await api(app, "POST", "/auth/2fa", {
      payload: { challenge: login.json<{ challenge: string }>().challenge, code: "000000" },
    });
    expect(late.json()).toMatchObject({ code: "challenge_expired" });
  });
});

describe("sessions", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let app: FastifyInstance;

  beforeEach(async () => {
    await clearAuthData(owner);
    app = await buildApp({
      db,
      config: testConfig(),
      mailer: NO_MAIL,
      jobs: NO_JOBS,
      checkReady: () => Promise.resolve(),
    });
  });

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  it("answers 401 with no cookie, a made-up one, and after logout", async () => {
    const user = await createUser(owner, { email: "out@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);

    expect((await api(app, "GET", "/me")).statusCode).toBe(401);
    expect((await api(app, "GET", "/me", { cookie: "made-up" })).statusCode).toBe(401);
    expect((await api(app, "POST", "/auth/logout", { cookie })).statusCode).toBe(204);
    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(401);
  });

  it("stores only a hash of the cookie, with the attributes of П6", async () => {
    const user = await createUser(owner, { email: "cookie@example.test" });
    const login = await loginPassword(app, user.email);

    const value = sessionCookieOf(login);
    const stored = await owner.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toContain(value);
    expect(login.cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  });

  it("marks the cookie Secure and __Host- in production", async () => {
    const secureApp = await buildApp({
      db,
      config: testConfig({ isProduction: true }),
      mailer: NO_MAIL,
      jobs: NO_JOBS,
      checkReady: () => Promise.resolve(),
    });
    await createUser(owner, { email: "secure@example.test" });

    const login = await loginPassword(secureApp, "secure@example.test");

    expect(login.cookies[0]).toMatchObject({ name: "__Host-session", secure: true, httpOnly: true, sameSite: "Lax" });
  });

  it("ends a session idle for seven days or older than thirty", async () => {
    const user = await createUser(owner, { email: "old@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);

    await owner.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000) } });
    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(401);

    await owner.session.updateMany({ data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() - 1) } });
    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(401);
  });

  it("slides the idle limit at most once an hour", async () => {
    const user = await createUser(owner, { email: "seen@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1_000);
    await owner.session.updateMany({ data: { lastSeenAt: stale } });

    await api(app, "GET", "/me", { cookie });

    const session = await owner.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.lastSeenAt.getTime()).toBeGreaterThan(stale.getTime());
  });

  it("lists sessions, ends one of them, refuses someone else's", async () => {
    const user = await createUser(owner, { email: "many@example.test" });
    const stranger = await createUser(owner, { email: "other@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);
    await signInWithSetup(app, owner, stranger);
    await rewindTotp(owner, user.id);
    const login = await loginPassword(app, user.email);
    const code = await totpCode(owner, user.id);
    const challenge = login.json<{ challenge: string }>().challenge;
    const second = sessionCookieOf(await api(app, "POST", "/auth/2fa", { payload: { challenge, code } }));

    const list = await api(app, "GET", "/me/sessions", { cookie });
    const { items } = list.json<{ items: { id: string; isCurrent: boolean }[] }>();
    expect(items).toHaveLength(2);
    expect(items.filter((item) => item.isCurrent)).toHaveLength(1);

    const foreign = await owner.session.findFirstOrThrow({ where: { userId: stranger.id } });
    expect((await api(app, "DELETE", `/me/sessions/${foreign.id}`, { cookie })).statusCode).toBe(404);

    const other = items.find((item) => !item.isCurrent)?.id ?? "";
    expect((await api(app, "DELETE", `/me/sessions/${other}`, { cookie })).statusCode).toBe(204);
    expect((await api(app, "GET", "/me", { cookie: second })).statusCode).toBe(401);
    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(200);
  });

  it("logs out everywhere", async () => {
    const user = await createUser(owner, { email: "all@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);

    expect((await api(app, "DELETE", "/me/sessions", { cookie })).statusCode).toBe(204);

    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(401);
    expect(await owner.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses a request from another site", async () => {
    const user = await createUser(owner, { email: "csrf@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);

    const refused = await api(app, "POST", "/auth/logout", { cookie, headers: { origin: "https://evil.test" } });
    const passed = await api(app, "POST", "/auth/logout", { cookie, headers: { origin: "http://app.test" } });

    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "origin_mismatch" });
    expect(passed.statusCode).toBe(204);
  });

  it("refuses it on a path spelled in percent signs too, which reaches the same route", async () => {
    const headers = { origin: "https://evil.test" };

    const refused = await app.inject({ method: "POST", url: "/%61pi/v1/auth/logout", headers });

    expect(refused.json()).toMatchObject({ code: "origin_mismatch" });
    const passed = await app.inject({
      method: "POST",
      url: "/%61pi/v1/auth/logout",
      headers: { origin: TEST_APP_URL },
    });
    expect(passed.statusCode).toBe(401);
  });
});

describe("passwords", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let app: FastifyInstance;
  let mailer: CapturingMailer;

  beforeEach(async () => {
    await clearAuthData(owner);
    mailer = captureMailer();
    app = await buildApp({ db, config: testConfig(), mailer, jobs: NO_JOBS, checkReady: () => Promise.resolve() });
  });

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  const tokenOf = (link: string | undefined) => (link ?? "").split("#token=")[1] ?? "";
  const linkInLetter = (index = 0) => /https?:\/\/\S+#token=\S+/.exec(mailer.sent[index]?.text ?? "")?.[0];
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const context = { actor: SYSTEM_ACTOR, ip: null, requestId: null };
  // The route answers before this work ends, so a test that expects nothing to happen has to wait for it directly
  const requestReset = (email: string) =>
    requestPasswordReset({ db, config: testConfig(), mailer, jobs: NO_JOBS, files: NO_FILES, logger }, context, email);
  const rewindLetters = (ageMs: number) =>
    owner.signInThrottle.updateMany({ data: { lastFailureAt: new Date(Date.now() - ageMs) } });

  it("resets by a letter, ends the sessions, and leads back to the code", async () => {
    const user = await createUser(owner, { email: "forgot@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);

    expect((await api(app, "POST", "/auth/password-reset", { payload: { email: user.email } })).statusCode).toBe(204);
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    const token = tokenOf(linkInLetter());

    const confirmed = await api(app, "POST", "/auth/password-reset/confirm", {
      payload: { token, password: NEW_PASSWORD },
    });
    expect(confirmed.statusCode).toBe(204);
    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(401);

    const login = await loginPassword(app, user.email, NEW_PASSWORD);
    expect(login.json()).toMatchObject({ status: LOGIN_STATUS.twoFactorRequired });

    const again = await api(app, "POST", "/auth/password-reset/confirm", {
      payload: { token, password: NEW_PASSWORD },
    });
    expect(again.statusCode).toBe(410);
  });

  it("is silent about an unknown address and sends nothing", async () => {
    const answer = await api(app, "POST", "/auth/password-reset", { payload: { email: "ghost@example.test" } });
    await requestReset("ghost@example.test");

    expect(answer.statusCode).toBe(204);
    await vi.waitFor(async () => {
      expect(await owner.activityEvent.count({ where: { action: "auth.password_reset_requested" } })).toBe(2);
    });
    expect(mailer.sent).toHaveLength(0);
  });

  it("sends nothing to a blocked person", async () => {
    const user = await createUser(owner, { email: "blocked@example.test", status: "blocked" });

    await requestReset(user.email);

    expect(mailer.sent).toHaveLength(0);
  });

  it("does not send a second letter within a minute", async () => {
    const user = await createUser(owner, { email: "twice@example.test" });

    await requestReset(user.email);
    await requestReset(user.email);

    expect(mailer.sent).toHaveLength(1);
  });

  it("sends one letter from a wave, and five a day at most", async () => {
    const user = await createUser(owner, { email: "flood@example.test" });

    await Promise.all(Array.from({ length: WAVE_SIZE }, () => requestReset(user.email)));
    expect(mailer.sent).toHaveLength(1);

    for (let letter = 0; letter < 5; letter += 1) {
      await rewindLetters(2 * MINUTE_MS);
      await requestReset(user.email);
    }
    expect(mailer.sent).toHaveLength(5);

    await rewindLetters(25 * HOUR_MS);
    await requestReset(user.email);
    expect(mailer.sent).toHaveLength(6);
  });

  it("keeps an earlier link alive when the form is pressed again, and ends both once one is used", async () => {
    const user = await createUser(owner, { email: "again@example.test" });
    await requestReset(user.email);
    await rewindLetters(2 * MINUTE_MS);
    await requestReset(user.email);

    const first = { token: tokenOf(linkInLetter(0)), password: NEW_PASSWORD };
    const second = { token: tokenOf(linkInLetter(1)), password: NEW_PASSWORD };
    expect((await api(app, "POST", "/auth/password-reset/confirm", { payload: first })).statusCode).toBe(204);
    expect((await api(app, "POST", "/auth/password-reset/confirm", { payload: second })).statusCode).toBe(410);
  });

  it("refuses a weak new password and leaves the link alive", async () => {
    const user = await createUser(owner, { email: "weak@example.test" });
    await requestReset(user.email);
    const token = tokenOf(linkInLetter());

    const weak = await api(app, "POST", "/auth/password-reset/confirm", { payload: { token, password: "qwertyuiop" } });
    expect(weak.statusCode).toBe(422);

    const confirmed = await api(app, "POST", "/auth/password-reset/confirm", {
      payload: { token, password: NEW_PASSWORD },
    });
    expect(confirmed.statusCode).toBe(204);
  });

  it("refuses a link past its hour", async () => {
    const user = await createUser(owner, { email: "late@example.test" });
    await api(app, "POST", "/auth/password-reset", { payload: { email: user.email } });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
    await owner.authToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });

    const answer = await api(app, "POST", "/auth/password-reset/confirm", {
      payload: { token: tokenOf(linkInLetter()), password: NEW_PASSWORD },
    });

    expect(answer.statusCode).toBe(410);
    expect(answer.json()).toMatchObject({ code: "reset_link_expired" });
  });

  it("gives a colleague the link when there is no mail", async () => {
    const noMailApp = await buildApp({
      db,
      config: testConfig(),
      mailer: NO_MAIL,
      jobs: NO_JOBS,
      checkReady: () => Promise.resolve(),
    });
    const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    const user = await createUser(owner, { email: "manual@example.test" });
    const { cookie } = await signInWithSetup(noMailApp, owner, admin);

    const answer = await api(noMailApp, "POST", `/users/${user.id}/password-reset`, { cookie, payload: {} });

    expect(answer.statusCode).toBe(200);
    const { delivery, link } = answer.json<{ delivery: string; link: string }>();
    expect(delivery).toBe("manual");
    const confirmed = await api(noMailApp, "POST", "/auth/password-reset/confirm", {
      payload: { token: tokenOf(link), password: NEW_PASSWORD },
    });
    expect(confirmed.statusCode).toBe(204);
  });

  it("hands a colleague's link over by letter when asked, and shows it when the letter fails", async () => {
    const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    const user = await createUser(owner, { email: "by-letter@example.test" });
    const { cookie } = await signInWithSetup(app, owner, admin);

    const sent = await api(app, "POST", `/users/${user.id}/password-reset`, { cookie, payload: { sendEmail: true } });
    expect(sent.json()).toMatchObject({ delivery: "email" });
    expect(mailer.sent).toHaveLength(1);

    mailer.send = () => Promise.reject(new Error("connection refused"));
    const shown = await api(app, "POST", `/users/${user.id}/password-reset`, { cookie, payload: { sendEmail: true } });
    expect(shown.json()).toMatchObject({ delivery: "manual" });
    const stale = { token: tokenOf(linkInLetter()), password: NEW_PASSWORD };
    expect((await api(app, "POST", "/auth/password-reset/confirm", { payload: stale })).statusCode).toBe(410);
  });

  it("gives no reset link for someone who is not active", async () => {
    const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    const user = await createUser(owner, { email: "invited@example.test", status: "invited", hasPassword: false });
    const { cookie } = await signInWithSetup(app, owner, admin);

    const answer = await api(app, "POST", `/users/${user.id}/password-reset`, { cookie, payload: {} });

    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code: "user_not_active" });
  });

  it("ends a link in a chat and a begun sign-in when the password changes in the profile", async () => {
    const user = await createUser(owner, { email: "chat@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);
    await requestReset(user.email);
    await loginPassword(app, user.email);

    const changed = await api(app, "POST", "/me/password", {
      cookie,
      payload: { currentPassword: STRONG_PASSWORD, newPassword: NEW_PASSWORD },
    });

    expect(changed.statusCode).toBe(204);
    expect(await owner.authToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
  });

  it("ends a begun sign-in when the password is reset", async () => {
    const user = await createUser(owner, { email: "reset-begun@example.test" });
    await signInWithSetup(app, owner, user);
    await requestReset(user.email);
    await loginPassword(app, user.email);

    const payload = { token: tokenOf(linkInLetter()), password: NEW_PASSWORD };
    await api(app, "POST", "/auth/password-reset/confirm", { payload });

    expect(await owner.authToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
  });

  it.each(["/me/password", "/me/2fa/recovery-codes", "/users/00000000-0000-7000-8000-000000000000/reset-2fa"])(
    "limits %s per address, so a stolen session cannot guess the password in waves",
    async (path) => {
      const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
      const { cookie } = await signInWithSetup(app, owner, admin);

      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect((await api(app, "POST", path, { cookie, payload: {} })).statusCode).toBe(400);
      }

      expect((await api(app, "POST", path, { cookie, payload: {} })).statusCode).toBe(429);
    },
  );

  it("refuses bad input by name, not by a crash", async () => {
    const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    const { cookie } = await signInWithSetup(app, owner, admin);

    const answers = await Promise.all([
      api(app, "POST", "/auth/login", { payload: { email: "not-an-email" } }),
      api(app, "POST", "/auth/2fa", { payload: { challenge: "" } }),
      api(app, "PATCH", "/me", { cookie, payload: { fullName: "" } }),
      api(app, "POST", "/me/password", { cookie, payload: {} }),
      api(app, "GET", "/users?cursor=not-a-uuid", { cookie }),
    ]);

    expect(answers.map(({ statusCode }) => statusCode)).toEqual([400, 400, 400, 400, 400]);
  });

  it("changes a password, ends the other sessions, keeps this one", async () => {
    const user = await createUser(owner, { email: "change@example.test" });
    const { cookie } = await signInWithSetup(app, owner, user);
    await rewindTotp(owner, user.id);
    const login = await loginPassword(app, user.email);
    const challenge = login.json<{ challenge: string }>().challenge;
    const code = await totpCode(owner, user.id);
    const other = sessionCookieOf(await api(app, "POST", "/auth/2fa", { payload: { challenge, code } }));

    const wrong = await api(app, "POST", "/me/password", {
      cookie,
      payload: { currentPassword: "неправильний пароль", newPassword: NEW_PASSWORD },
    });
    expect(wrong.statusCode).toBe(422);

    const changed = await api(app, "POST", "/me/password", {
      cookie,
      payload: { currentPassword: STRONG_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(changed.statusCode).toBe(204);
    expect((await api(app, "GET", "/me", { cookie })).statusCode).toBe(200);
    expect((await api(app, "GET", "/me", { cookie: other })).statusCode).toBe(401);
  });

  it.each(["qwertyuiop", "1234567890", "aaaaaaaaaaaa", "change@example.test"])(
    "refuses %s as a password",
    async (bad) => {
      const user = await createUser(owner, { email: "change@example.test" });
      const { cookie } = await signInWithSetup(app, owner, user);

      const answer = await api(app, "POST", "/me/password", {
        cookie,
        payload: { currentPassword: STRONG_PASSWORD, newPassword: bad },
      });

      expect(answer.statusCode).toBe(422);
      expect(answer.json()).toMatchObject({ message: "Пароль занадто простий або поширений" });
    },
  );
});

describe("auth.cleanup", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  it("removes only what is dead, and a repeat changes nothing", async () => {
    await clearAuthData(owner);
    const user = await createUser(owner, { email: "clean@example.test" });
    const now = Date.now();
    const yesterday = new Date(now - 24 * 60 * 60 * 1_000);
    const sessionBase = { userId: user.id, tokenHash: "", expiresAt: new Date(now + 60_000) };
    await owner.session.create({ data: { ...sessionBase, tokenHash: "live" } });
    await owner.session.create({ data: { ...sessionBase, tokenHash: "expired", expiresAt: yesterday } });
    await owner.session.create({
      data: { ...sessionBase, tokenHash: "idle", lastSeenAt: new Date(now - 8 * 24 * 60 * 60 * 1_000) },
    });
    const tokenBase = {
      userId: user.id,
      type: "invitation" as const,
      tokenHash: "",
      expiresAt: new Date(now + 60_000),
    };
    await owner.authToken.create({ data: { ...tokenBase, tokenHash: "live-token" } });
    await owner.authToken.create({ data: { ...tokenBase, tokenHash: "dead-token", expiresAt: yesterday } });
    const throttleBase = { failures: 1, firstFailureAt: new Date(now), lastFailureAt: new Date(now) };
    await owner.signInThrottle.create({ data: { ...throttleBase, key: "fresh" } });
    await owner.signInThrottle.create({
      data: { ...throttleBase, key: "stale", lastFailureAt: new Date(now - 2 * 24 * 60 * 60 * 1_000) },
    });

    expect(await runAuthCleanup(db)).toEqual({ sessions: 2, tokens: 1, throttles: 1 });
    expect(await runAuthCleanup(db)).toEqual({ sessions: 0, tokens: 0, throttles: 0 });
    expect(await owner.session.count()).toBe(1);
    expect(await owner.authToken.count()).toBe(1);
    expect(await owner.signInThrottle.count()).toBe(1);
  });
});
