import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../app.js";
import { isUniqueViolation, type DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase, testDatabaseUrl } from "../../core/db/test-database.js";
import { createSession } from "../../core/session/session.repository.js";
import { captureMailer, NO_MAIL, testConfig, type CapturingMailer } from "../../core/test-app.js";
import {
  api,
  clearAuthData,
  createUser,
  loginPassword,
  sessionCookieOf,
  signInWithSetup,
  STRONG_PASSWORD,
} from "../../test-auth.js";
import { PrismaClient } from "../../generated/prisma/client.js";
import { ensureFirstAdmin } from "./index.js";
import { listUsers } from "./users.queries.js";

const INVITE = { email: "Olena@Example.test", fullName: "Олена Коваль", roleKey: "manager" };
const PASSWORD = "пароль для нової людини";

describe("users", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let app: FastifyInstance;
  let mailer: CapturingMailer;
  let cookie: string;
  let admin: { id: string; email: string };

  beforeEach(async () => {
    await clearAuthData(owner);
    mailer = captureMailer();
    app = await buildApp({ db, config: testConfig(), mailer, checkReady: () => Promise.resolve() });
    admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
    ({ cookie } = await signInWithSetup(app, owner, admin));
  });

  afterAll(async () => {
    await owner.$disconnect();
    await db.$disconnect();
  });

  const tokenInLetter = () => /#token=(\S+)/.exec(mailer.sent.at(-1)?.text ?? "")?.[1] ?? "";

  it("invites by letter, takes the password, and holds the new person at the setup of 2FA", async () => {
    const invited = await api(app, "POST", "/users/invitations", { cookie, payload: INVITE });
    expect(invited.json()).toEqual({ delivery: "email" });
    expect(mailer.sent[0]?.to).toBe("olena@example.test");
    expect(mailer.sent[0]?.html).toContain("Олена Коваль");

    const list = await api(app, "GET", "/users", { cookie });
    expect(list.json<{ items: { status: string }[] }>().items.map((item) => item.status)).toEqual([
      "active",
      "invited",
    ]);

    const accepted = await api(app, "POST", "/invitations/accept", {
      payload: { token: tokenInLetter(), password: PASSWORD },
    });
    expect(accepted.statusCode).toBe(204);
    const held = sessionCookieOf(accepted);
    expect((await api(app, "GET", "/users", { cookie: held })).statusCode).toBe(403);
    expect((await api(app, "POST", "/me/2fa/setup", { cookie: held })).statusCode).toBe(200);

    const repeat = await api(app, "POST", "/invitations/accept", {
      payload: { token: tokenInLetter(), password: PASSWORD },
    });
    expect(repeat.statusCode).toBe(410);
    expect(repeat.json()).toMatchObject({ message: "Запрошення застаріло. Попросіть надіслати нове" });

    const actions = (await owner.activityEvent.findMany()).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(["user.invited", "user.invitation_accepted"]));
  });

  it("gives the link instead when there is no mail", async () => {
    const noMailApp = await buildApp({
      db,
      config: testConfig(),
      mailer: NO_MAIL,
      checkReady: () => Promise.resolve(),
    });

    const invited = await api(noMailApp, "POST", "/users/invitations", { cookie, payload: INVITE });

    const { delivery, link } = invited.json<{ delivery: string; link: string }>();
    expect(delivery).toBe("manual");
    expect(link).toMatch(/^http:\/\/app\.test\/invite#token=/);
    const token = link.split("#token=")[1];
    const accepted = await api(noMailApp, "POST", "/invitations/accept", { payload: { token, password: PASSWORD } });
    expect(accepted.statusCode).toBe(204);
  });

  it("gives the link when the letter fails, and the invitation stands", async () => {
    const failing = { isConfigured: true, send: () => Promise.reject(new Error("connection refused")) };
    const brokenApp = await buildApp({
      db,
      config: testConfig(),
      mailer: failing,
      checkReady: () => Promise.resolve(),
    });

    const invited = await api(brokenApp, "POST", "/users/invitations", { cookie, payload: INVITE });

    expect(invited.statusCode).toBe(200);
    expect(invited.json()).toMatchObject({ delivery: "manual" });
    expect(await owner.user.count({ where: { email: "olena@example.test" } })).toBe(1);
  });

  it("cancels the previous invitation on a new one", async () => {
    await api(app, "POST", "/users/invitations", { cookie, payload: INVITE });
    const first = tokenInLetter();
    const { id } = await owner.user.findUniqueOrThrow({ where: { email: "olena@example.test" } });

    const again = await api(app, "POST", `/users/${id}/reinvite`, { cookie, payload: {} });
    expect(again.json()).toEqual({ delivery: "email" });

    const old = await api(app, "POST", "/invitations/accept", { payload: { token: first, password: PASSWORD } });
    expect(old.statusCode).toBe(410);
    const fresh = await api(app, "POST", "/invitations/accept", {
      payload: { token: tokenInLetter(), password: PASSWORD },
    });
    expect(fresh.statusCode).toBe(204);
  });

  it("copies the link without a letter when asked", async () => {
    await api(app, "POST", "/users/invitations", { cookie, payload: INVITE });
    const { id } = await owner.user.findUniqueOrThrow({ where: { email: "olena@example.test" } });

    const copied = await api(app, "POST", `/users/${id}/reinvite`, { cookie, payload: { sendEmail: false } });

    expect(copied.json()).toMatchObject({ delivery: "manual" });
    expect(mailer.sent).toHaveLength(1);
  });

  it("refuses an invitation past its 72 hours", async () => {
    await api(app, "POST", "/users/invitations", { cookie, payload: INVITE });
    await owner.authToken.updateMany({ where: { type: "invitation" }, data: { expiresAt: new Date(Date.now() - 1) } });

    const late = await api(app, "POST", "/invitations/accept", {
      payload: { token: tokenInLetter(), password: PASSWORD },
    });

    expect(late.statusCode).toBe(410);
  });

  it("refuses a weak password at the invitation and leaves the token alive", async () => {
    await api(app, "POST", "/users/invitations", { cookie, payload: INVITE });

    const weak = await api(app, "POST", "/invitations/accept", {
      payload: { token: tokenInLetter(), password: "qwertyuiop" },
    });
    expect(weak.statusCode).toBe(422);

    const fine = await api(app, "POST", "/invitations/accept", {
      payload: { token: tokenInLetter(), password: PASSWORD },
    });
    expect(fine.statusCode).toBe(204);
  });

  it.each([
    ["invited", "user_already_invited"],
    ["active", "user_already_active"],
    ["blocked", "user_blocked"],
  ] as const)("says what to do with an email already %s", async (status, code) => {
    await createUser(owner, { email: "olena@example.test", status });

    const answer = await api(app, "POST", "/users/invitations", { cookie, payload: INVITE });

    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code });
  });

  it("refuses bad input with the field named", async () => {
    const answer = await api(app, "POST", "/users/invitations", {
      cookie,
      payload: { ...INVITE, email: "not-an-email", extra: true },
    });
    expect(answer.statusCode).toBe(400);
    expect(answer.json()).toMatchObject({ code: "validation_failed" });

    const badId = await api(app, "POST", "/users/not-a-uuid/block", { cookie });
    expect(badId.statusCode).toBe(400);
  });

  it("answers 404 for an id that does not exist", async () => {
    const id = "019a0000-0000-7000-8000-000000000000";
    expect((await api(app, "POST", `/users/${id}/block`, { cookie })).statusCode).toBe(404);
    expect((await api(app, "POST", `/users/${id}/unblock`, { cookie })).statusCode).toBe(404);
    expect((await api(app, "POST", `/users/${id}/reinvite`, { cookie, payload: {} })).statusCode).toBe(404);
    expect((await api(app, "POST", `/users/${id}/password-reset`, { cookie, payload: {} })).statusCode).toBe(404);
  });

  it("blocks: the next request is a 401, the login gives the common refusal, and unblocking lets back in", async () => {
    const user = await createUser(owner, { email: "worker@example.test" });
    const { cookie: workerCookie } = await signInWithSetup(app, owner, user);

    expect((await api(app, "POST", `/users/${user.id}/block`, { cookie })).statusCode).toBe(204);

    expect((await api(app, "GET", "/me", { cookie: workerCookie })).statusCode).toBe(401);
    expect(await owner.session.count({ where: { userId: user.id } })).toBe(0);
    const refused = await loginPassword(app, user.email);
    expect(refused.statusCode).toBe(401);
    expect(refused.json()).toMatchObject({ code: "invalid_credentials" });

    expect((await api(app, "POST", `/users/${user.id}/unblock`, { cookie })).statusCode).toBe(204);
    expect((await loginPassword(app, user.email)).statusCode).toBe(200);
  });

  it("returns a blocked invited person to invited, with the old link dead", async () => {
    await api(app, "POST", "/users/invitations", { cookie, payload: INVITE });
    const token = tokenInLetter();
    const { id } = await owner.user.findUniqueOrThrow({ where: { email: "olena@example.test" } });

    await api(app, "POST", `/users/${id}/block`, { cookie });
    await api(app, "POST", `/users/${id}/unblock`, { cookie });

    expect((await owner.user.findUniqueOrThrow({ where: { id } })).status).toBe("invited");
    const accepted = await api(app, "POST", "/invitations/accept", { payload: { token, password: PASSWORD } });
    expect(accepted.statusCode).toBe(410);
  });

  it("leaves one of two people who block each other at once", async () => {
    const other = await createUser(owner, { email: "other-admin@example.test", roleKey: "admin" });
    const { cookie: otherCookie } = await signInWithSetup(app, owner, other);

    const answers = await Promise.all([
      api(app, "POST", `/users/${other.id}/block`, { cookie }),
      api(app, "POST", `/users/${admin.id}/block`, { cookie: otherCookie }),
    ]);

    expect(answers.filter(({ statusCode }) => statusCode === 204)).toHaveLength(1);
    const ids = [admin.id, other.id];
    expect(await owner.user.count({ where: { id: { in: ids }, status: "active" } })).toBe(1);
  });

  it("wakes nothing that slipped in around the block", async () => {
    const user = await createUser(owner, { email: "slipped@example.test" });
    await api(app, "POST", `/users/${user.id}/block`, { cookie });
    const slipped = await createSession(owner, user.id, { ip: null, userAgent: null });
    await owner.authToken.create({
      data: { userId: user.id, type: "password_reset", tokenHash: "x", expiresAt: new Date(Date.now() + 60_000) },
    });

    expect((await api(app, "POST", `/users/${user.id}/unblock`, { cookie })).statusCode).toBe(204);

    expect((await api(app, "GET", "/me", { cookie: slipped.token })).statusCode).toBe(401);
    expect(await owner.authToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0);
  });

  it("tells the slower of two invitations that the address is taken", async () => {
    const answers = await Promise.all([
      api(app, "POST", "/users/invitations", { cookie, payload: INVITE }),
      api(app, "POST", "/users/invitations", { cookie, payload: INVITE }),
    ]);

    expect(answers.map(({ statusCode }) => statusCode).sort()).toEqual([200, 409]);
    expect(mailer.sent).toHaveLength(1);
  });

  it("knows a unique refusal when it sees one", async () => {
    await createUser(owner, { email: "twin@example.test" });

    const refusal: unknown = await createUser(owner, { email: "twin@example.test" }).catch((error: unknown) => error);

    expect(isUniqueViolation(refusal)).toBe(true);
  });

  it("refuses a repeat invitation for someone who already accepted", async () => {
    const user = await createUser(owner, { email: "accepted@example.test" });

    const answer = await api(app, "POST", `/users/${user.id}/reinvite`, { cookie, payload: {} });

    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code: "user_not_invited" });
  });

  it("does not let a person block themselves", async () => {
    const answer = await api(app, "POST", `/users/${admin.id}/block`, { cookie });

    expect(answer.statusCode).toBe(409);
    expect(answer.json()).toMatchObject({ code: "cannot_block_self" });
  });

  it("updates the profile and journals before and after", async () => {
    const answer = await api(app, "PATCH", "/me", { cookie, payload: { fullName: "Нове Ім'я" } });

    expect(answer.json()).toMatchObject({ fullName: "Нове Ім'я", email: admin.email });
    const event = await owner.activityEvent.findFirstOrThrow({ where: { action: "user.profile_updated" } });
    expect(event.changes).toMatchObject({ fullName: [`Користувач ${admin.email}`, "Нове Ім'я"] });
    expect(event.actorId).toBe(admin.id);
  });

  it("pages the list by cursor", async () => {
    for (let index = 0; index < 3; index += 1) await createUser(owner, { email: `p${index}@example.test` });

    const first = await api(app, "GET", "/users?limit=2", { cookie });
    const page = first.json<{ items: unknown[]; nextCursor: string }>();
    expect(page.items).toHaveLength(2);
    const second = await api(app, "GET", `/users?limit=2&cursor=${page.nextCursor}`, { cookie });
    const rest = second.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(rest.items).toHaveLength(2);
    expect(rest.nextCursor).toBeNull();
  });
});

describe("the user list", () => {
  const owner: DbClient = connectTestDatabase();
  const counted = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl() }),
    log: [{ emit: "event", level: "query" }],
  });
  let statements = 0;
  counted.$on("query", () => {
    statements += 1;
  });

  afterAll(async () => {
    await owner.$disconnect();
    await counted.$disconnect();
  });

  async function statementsFor(limit: number): Promise<number> {
    statements = 0;
    const { items } = await listUsers(counted, { limit });
    expect(items).toHaveLength(limit);
    return statements;
  }

  it("takes as many statements for 25 rows as for 5", async () => {
    await clearAuthData(owner);
    for (let index = 0; index < 26; index += 1) await createUser(owner, { email: `n${index}@example.test` });

    expect(await statementsFor(25)).toBe(await statementsFor(5));
  });
});

describe("first administrator", () => {
  const owner: DbClient = connectTestDatabase();

  afterAll(() => owner.$disconnect());

  it("is created on an empty table only, and can sign in", async () => {
    await clearAuthData(owner);
    const input = { email: "first@example.test", fullName: "Перший Адмін", password: STRONG_PASSWORD };

    expect(await ensureFirstAdmin({ db: owner }, input)).toBe(true);
    expect(await ensureFirstAdmin({ db: owner }, { ...input, email: "second@example.test" })).toBe(false);

    const users = await owner.user.findMany({ include: { role: true } });
    expect(users.map((user) => [user.email, user.role.key, user.status])).toEqual([
      ["first@example.test", "admin", "active"],
    ]);
    expect(await owner.activityEvent.count({ where: { action: "user.first_admin_created" } })).toBe(1);
  });

  it("comes out once from two setups at the same moment", async () => {
    await clearAuthData(owner);
    const input = { email: "first@example.test", fullName: "Перший Адмін", password: STRONG_PASSWORD };

    const created = await Promise.all([
      ensureFirstAdmin({ db: owner }, input),
      ensureFirstAdmin({ db: owner }, { ...input, email: "second@example.test" }),
    ]);

    expect(created.filter(Boolean)).toHaveLength(1);
    expect(await owner.user.count()).toBe(1);
  });

  it("refuses a weak password rather than start with one", async () => {
    await clearAuthData(owner);
    const input = { email: "first@example.test", fullName: "Перший Адмін", password: "qwertyuiop" };

    await expect(ensureFirstAdmin({ db: owner }, input)).rejects.toThrow("Пароль занадто простий");
    expect(await owner.user.count()).toBe(0);
  });
});
