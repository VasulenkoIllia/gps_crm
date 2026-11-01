import { expect, type Browser, type Page } from "@playwright/test";
import { base32Decode, hotp, stepAt } from "../apps/api/src/modules/two-factor/totp.ts";

export const ADMIN_EMAIL = "admin@example.test";
export const PASSWORD = "довгий пароль для наскрізного тесту";
// A signed-in administrator for the specs after auth.spec.ts: 2FA codes stay with the Authenticator of that file
export const ADMIN_SESSION_FILE = ".tmp/e2e-admin-session.json";

const STEP_MS = 30_000;
const POLL_MS = 500;
const MAIL_TIMEOUT_MS = 15_000;

const adminPassword = (): string => {
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!password) throw new Error("E2E_ADMIN_PASSWORD is not set");
  return password;
};

const mailpitUrl = (): string => {
  const url = process.env.E2E_MAILPIT_URL;
  if (!url) throw new Error("E2E_MAILPIT_URL is not set");
  return url;
};

// Stands for the phone: a code is spent once, so it moves to the next step the server still takes, or waits for one
export class Authenticator {
  private readonly key: Buffer;
  private lastStep = 0;

  constructor(secret: string) {
    this.key = base32Decode(secret);
  }

  async nextCode(): Promise<string> {
    const now = Date.now();
    const step = Math.max(stepAt(now) - 1, this.lastStep + 1);
    const earliest = (step - 1) * STEP_MS;
    if (earliest > now) await new Promise((resolve) => setTimeout(resolve, earliest - now));
    this.lastStep = step;
    return hotp(this.key, step);
  }
}

export async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Увійти" }).click();
}

export async function loginAsNewAdmin(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await fillLogin(page, ADMIN_EMAIL, adminPassword());
}

export async function loginAsAdmin(page: Page, phone: Authenticator, baseUrl = ""): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await fillLogin(page, ADMIN_EMAIL, adminPassword());
  await enterCode(page, await phone.nextCode());
  await expect(page.getByRole("button", { name: "Меню користувача" })).toBeVisible();
}

export async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel("Код").fill(code);
  await page.getByRole("button", { name: "Підтвердити" }).click();
}

// From the QR page to the app. The secret comes from the screen, the way a person types it into a phone.
export async function finishSetup(page: Page): Promise<{ phone: Authenticator; recoveryCodes: string[] }> {
  await expect(page.getByRole("heading", { name: "Двофакторний вхід" })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR-код для застосунку" })).toBeVisible();
  const secret = (await page.locator(".manual-secret").textContent()) ?? "";
  const phone = new Authenticator(secret);
  await page.getByLabel("Код із застосунку").fill(await phone.nextCode());
  await page.getByRole("button", { name: "Увімкнути" }).click();

  await expect(page.getByRole("heading", { name: "Коди відновлення" })).toBeVisible();
  const recoveryCodes = await page
    .getByRole("list", { name: "Коди відновлення" })
    .getByRole("listitem")
    .allTextContents();
  await page.getByLabel("Коди збережено").check();
  await page.getByRole("button", { name: "Перейти до роботи" }).click();
  await expect(page.getByRole("button", { name: "Меню користувача" })).toBeVisible();
  return { phone, recoveryCodes };
}

export async function inviteUser(page: Page, baseUrl: string, fullName: string, email: string): Promise<void> {
  await page.goto(`${baseUrl}/users`);
  await page.getByRole("button", { name: "Запросити" }).click();
  await page.getByLabel("ПІБ").fill(fullName);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Менеджер").check();
  await page.getByRole("dialog").getByRole("button", { name: "Запросити" }).click();
}

export async function acceptInvitation(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await page.getByLabel("Пароль", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Повторіть пароль").fill(PASSWORD);
  await page.getByRole("button", { name: "Створити пароль" }).click();
}

interface MailSummary {
  ID: string;
  To: { Address: string }[];
}

export async function waitForLink(to: string): Promise<string> {
  const deadline = Date.now() + MAIL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitUrl()}/api/v1/messages`);
    const { messages } = (await search.json()) as { messages: MailSummary[] };
    const letter = messages.find((message) => message.To.some(({ Address }) => Address === to));
    if (letter) {
      const body = await fetch(`${mailpitUrl()}/api/v1/message/${letter.ID}`);
      const { Text } = (await body.json()) as { Text: string };
      await fetch(`${mailpitUrl()}/api/v1/messages`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ IDs: [letter.ID] }),
      });
      const link = /https?:\/\/\S+#token=\S+/.exec(Text)?.[0];
      if (!link) throw new Error("the letter has no link");
      return link;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`no letter for ${to}`);
}

export async function newPerson(browser: Browser, baseUrl: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: baseUrl, locale: "uk-UA" });
  return context.newPage();
}
