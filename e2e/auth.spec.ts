import { expect, test, type Page } from "@playwright/test";
import { NO_MAIL_URL, WITH_MAIL_URL } from "../playwright.config.ts";
import {
  acceptInvitation,
  Authenticator,
  enterCode,
  fillLogin,
  finishSetup,
  inviteUser,
  loginAsAdmin,
  loginAsNewAdmin,
  newPerson,
  PASSWORD,
  waitForLink,
} from "./support.ts";

const NEW_PASSWORD = "інший довгий пароль наскрізного тесту";
const WORKER_EMAIL = "worker@example.test";
const MANUAL_EMAIL = "manual@example.test";

// One story on one database: each step stands on the people the earlier ones created
test.describe.serial("sign-in and users", () => {
  let admin: Page;
  let adminPhone: Authenticator;
  let workerPhone: Authenticator;
  let workerCodes: string[];

  test.beforeAll(async ({ browser }) => {
    admin = await newPerson(browser, WITH_MAIL_URL);
  });

  test("a stranger meets the sign-in page, and it remembers the address", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?next=%2Fusers$/);
    await expect(page.getByRole("heading", { name: "Вхід" })).toBeVisible();
  });

  test("the first administrator signs in and is held at the setup of 2FA", async () => {
    await loginAsNewAdmin(admin, WITH_MAIL_URL);
    await expect(admin).toHaveURL(/\/setup-2fa$/);

    await admin.goto("/users");
    await expect(admin).toHaveURL(/\/setup-2fa$/);

    ({ phone: adminPhone } = await finishSetup(admin));
    await admin.goto("/users");
    await expect(admin.getByRole("cell", { name: "Перший Адмін" })).toBeVisible();
  });

  test("the session cookie is what production sets", async () => {
    const cookies = await admin.context().cookies();
    expect(cookies.find(({ name }) => name === "__Host-session")).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
  });

  test("signing out ends the session, and a code is needed to come back", async () => {
    await admin.getByRole("button", { name: "Меню користувача" }).click();
    await admin.getByRole("menuitem", { name: "Вийти" }).click();
    await expect(admin).toHaveURL(/\/login$/);

    await admin.goto("/users");
    await expect(admin).toHaveURL(/\/login/);

    await fillLogin(admin, "admin@example.test", process.env.E2E_ADMIN_PASSWORD ?? "");
    await enterCode(admin, "000000");
    await expect(admin.getByRole("alert")).toHaveText("Код не підходить. Перевірте час на телефоні");
    await enterCode(admin, await adminPhone.nextCode());
    await expect(admin).toHaveURL(/\/users$/);
  });

  test("a wrong password gets the one common answer", async ({ page }) => {
    await page.goto("/login");
    await fillLogin(page, "nobody@example.test", "неправильний пароль");
    await expect(page.getByRole("alert")).toHaveText("Неправильний email або пароль");
  });

  test("an invitation by letter leads through the password and 2FA to the app", async ({ browser }) => {
    await inviteUser(admin, WITH_MAIL_URL, "Олена Коваль", WORKER_EMAIL);
    await expect(admin.getByText("Лист надіслано")).toBeVisible();
    await expect(admin.getByRole("row", { name: /Олена Коваль/ }).getByText("Запрошений")).toBeVisible();

    const worker = await newPerson(browser, WITH_MAIL_URL);
    await acceptInvitation(worker, await waitForLink(WORKER_EMAIL));
    await expect(worker).toHaveURL(/\/setup-2fa$/);
    ({ phone: workerPhone, recoveryCodes: workerCodes } = await finishSetup(worker));
    await expect(worker.getByRole("button", { name: "Меню користувача" })).toContainText("Олена Коваль");
    await worker.context().close();
  });

  test("with no mail the invitation gives a link to pass by hand", async ({ browser }) => {
    const here = await newPerson(browser, NO_MAIL_URL);
    await loginAsAdmin(here, adminPhone, NO_MAIL_URL);
    await expect(here.getByRole("button", { name: "Меню користувача" })).toBeVisible();

    await inviteUser(here, NO_MAIL_URL, "Без Пошти", MANUAL_EMAIL);
    const dialog = here.getByRole("dialog", { name: "Лист не надіслано" });
    await expect(dialog).toBeVisible();
    const link = (await dialog.locator(".link-box").textContent()) ?? "";
    expect(link).toContain(`${NO_MAIL_URL}/invite#token=`);

    const person = await newPerson(browser, NO_MAIL_URL);
    await acceptInvitation(person, link);
    await finishSetup(person);
    await person.context().close();
    await here.context().close();
  });

  test("a recovery code signs in when the phone is gone, and only once", async ({ page }) => {
    const code = workerCodes[0] ?? "";
    await page.goto("/login");
    await fillLogin(page, WORKER_EMAIL, PASSWORD);
    await enterCode(page, code);
    await expect(page.getByRole("button", { name: "Меню користувача" })).toBeVisible();

    await page.getByRole("button", { name: "Меню користувача" }).click();
    await page.getByRole("menuitem", { name: "Вийти" }).click();
    await page.waitForURL(/\/login$/);
    await fillLogin(page, WORKER_EMAIL, PASSWORD);
    await enterCode(page, code);
    await expect(page.getByRole("alert")).toHaveText("Код не підходить. Перевірте час на телефоні");
  });

  test("a forgotten password comes back by a letter", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Забули пароль?" }).click();
    await expect(page.getByRole("heading", { name: "Відновлення пароля" })).toBeVisible();
    await page.getByLabel("Email").fill(WORKER_EMAIL);
    await page.getByRole("button", { name: "Надіслати посилання" }).click();
    await expect(page.getByRole("alert")).toContainText("Якщо такий email є в системі");

    await page.goto(await waitForLink(WORKER_EMAIL));
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByLabel("Новий пароль").fill(NEW_PASSWORD);
    await page.getByLabel("Повторіть пароль").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Зберегти пароль" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await fillLogin(page, WORKER_EMAIL, NEW_PASSWORD);
    await enterCode(page, await workerPhone.nextCode());
    await expect(page.getByRole("button", { name: "Меню користувача" })).toBeVisible();
  });

  test("a blocked person is put out at the next request and cannot come back", async ({ browser }) => {
    const worker = await newPerson(browser, WITH_MAIL_URL);
    await worker.goto("/login");
    await fillLogin(worker, WORKER_EMAIL, NEW_PASSWORD);
    await enterCode(worker, await workerPhone.nextCode());
    await expect(worker.getByRole("button", { name: "Меню користувача" })).toBeVisible();

    await admin.goto("/users");
    await admin
      .getByRole("row", { name: /Олена Коваль/ })
      .getByRole("button", { name: "Дії" })
      .click();
    await admin.getByRole("menuitem", { name: "Заблокувати" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Заблокувати" }).click();
    await expect(admin.getByRole("row", { name: /Олена Коваль/ }).getByText("Заблокований")).toBeVisible();

    await worker.goto("/profile");
    await expect(worker).toHaveURL(/\/login\?next=%2Fprofile$/);
    await fillLogin(worker, WORKER_EMAIL, NEW_PASSWORD);
    await expect(worker.getByRole("alert")).toHaveText("Неправильний email або пароль");
    await worker.context().close();
  });

  test("a lost session leaves the page for the sign-in, from a query and from a change", async ({ browser }) => {
    const here = await newPerson(browser, WITH_MAIL_URL);
    await loginAsAdmin(here, adminPhone);
    await here.goto("/profile");
    await expect(here.getByRole("heading", { name: "Активні сесії" })).toBeVisible();

    await here.context().clearCookies();
    await here.getByRole("link", { name: "Користувачі" }).click();
    await expect(here).toHaveURL(/\/login\?next=%2Fusers$/);

    await loginAsAdmin(here, adminPhone);
    await here.goto("/profile");
    await expect(here.getByRole("heading", { name: "Активні сесії" })).toBeVisible();
    await here.context().clearCookies();
    await here.getByRole("button", { name: "Зберегти" }).click();
    await expect(here).toHaveURL(/\/login\?next=%2Fprofile$/);
    await here.context().close();
  });
});
