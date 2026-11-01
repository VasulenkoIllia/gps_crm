import { addDays, firstOfNextMonth, todayKyiv } from "@gps_crm/shared";
import { expect, test, type Page, type Request } from "@playwright/test";
import {
  ADMIN_SESSION_FILE,
  createClient,
  expectNoSidewaysScroll,
  PHONE,
  pick,
  pressInForm,
  rowAction,
  save,
  typeDate,
} from "./support.ts";

const PROGRAM = "Програма А";
const TARIFF = /^Тариф 1 2027,/;
const OLD_TARIFF = /^Тариф 1,/;
const COMPANY_TYPE = "Юрособа або ФОП (B2B)";
const STATE_TYPE = "Держзамовник (B2G)";
const PERSON = "Петренко Петро Петрович";
const COMPANY = "Компанія 1";
const SECOND_COMPANY = "Компанія 2";
const STATE_CLIENT = "Держустанова 1";
const OLD_CODE = "OLD-77";
const EDRPOU = "12345678";
const FREE_CODE = "60000";
const CONTRACT = "Д-1/2026";
const CONTRACT_FILE = "contract.pdf";

const shownDate = (date: string) => date.split("-").reverse().join(".");

async function openCard(page: Page, name: string): Promise<void> {
  await page.goto("/subscribers");
  await page.getByLabel("Пошук").fill(name);
  await page.getByRole("row", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function openTab(page: Page, tab: string): Promise<void> {
  await page.getByRole("tab", { name: tab }).click();
}

async function searchList(page: Page, text: string): Promise<void> {
  await page.goto("/subscribers");
  await page.getByLabel("Пошук").fill(text);
}

// system.spec.ts runs next and starts from an empty archive: every package opened here is restored here
test.describe.serial("the clients", () => {
  test.use({ storageState: ADMIN_SESSION_FILE });

  let companyCode = 0;

  test("the series of ID are set on their own screen, and a type moves over with a warning", async ({ page }) => {
    await page.goto("/id-series");
    await expect(page.getByRole("row", { name: /Фізособи/ })).toContainText("10000");
    await page.getByRole("button", { name: "Нова серія" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Назва").fill("Держзамовники");
    await pick(page, "Типи клієнтів", STATE_TYPE);
    await expect(form.getByText("перейде із серії «Юрособи»", { exact: false })).toBeVisible();
    await form.getByLabel("Від").fill("100000");
    await form.getByLabel("До").fill("199999");
    await form.getByLabel("Наступний номер").fill("100000");
    await save(page);
    await expect(page.getByRole("row", { name: /Держзамовники/ })).toContainText(STATE_TYPE);
    await expect(page.getByRole("row", { name: /Юрособи/ })).not.toContainText(STATE_TYPE);

    await page.getByRole("button", { name: "Нова серія" }).click();
    await form.getByLabel("Назва").fill("Перетин");
    await form.getByLabel("Від").fill("15000");
    await form.getByLabel("До").fill("16000");
    await form.getByLabel("Наступний номер").fill("15000");
    await pressInForm(page, "Зберегти");
    await expect(form.getByText("перетинається", { exact: false }).first()).toBeVisible();
    await form.getByRole("button", { name: "Скасувати" }).click();
    await page
      .getByRole("dialog", { name: "Закрити без збереження?" })
      .getByRole("button", { name: "Закрити", exact: true })
      .click();
  });

  test("a person, a company and a state client take their ID from their own series", async ({ page }) => {
    const validFrom = shownDate(todayKyiv());
    const personCode = await createClient(page, { name: PERSON, program: PROGRAM, tariff: TARIFF, validFrom });
    expect(personCode).toBeGreaterThanOrEqual(10_000);
    expect(personCode).toBeLessThanOrEqual(49_999);

    companyCode = await createClient(page, {
      name: COMPANY,
      type: COMPANY_TYPE,
      taxId: EDRPOU,
      legacyCode: OLD_CODE,
      program: PROGRAM,
      tariff: TARIFF,
      phone: "+380502223344",
    });
    expect(companyCode).toBeGreaterThanOrEqual(50_000);
    expect(companyCode).toBeLessThanOrEqual(99_999);

    const stateCode = await createClient(page, {
      name: STATE_CLIENT,
      type: STATE_TYPE,
      taxId: "87654322",
      program: PROGRAM,
      tariff: TARIFF,
      phone: "+380503334455",
    });
    expect(stateCode).toBe(100_000);
  });

  test("a client is found by the new ID and by the old number", async ({ page }) => {
    await searchList(page, String(companyCode));
    await expect(page.getByRole("row", { name: new RegExp(COMPANY) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(PERSON) })).toHaveCount(0);

    await searchList(page, OLD_CODE);
    await expect(page.getByRole("row", { name: new RegExp(COMPANY) })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(PERSON) })).toHaveCount(0);
    await expect(page.getByText("Клієнтів: 1")).toBeVisible();
  });

  test("a form warns about a duplicate without stopping the work", async ({ page }) => {
    await page.goto("/subscribers");
    await page.getByRole("button", { name: "Новий клієнт" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("ЄДРПОУ / ІПН").fill(EDRPOU);
    await expect(form.getByText("Можливі дублікати")).toBeVisible();
    await expect(form.getByRole("link", { name: COMPANY })).toBeVisible();
    await form.getByRole("button", { name: "Скасувати" }).click();
    await page
      .getByRole("dialog", { name: "Закрити без збереження?" })
      .getByRole("button", { name: "Закрити", exact: true })
      .click();
  });

  test("an ID changed by hand stands in the journal, and the old one is free again", async ({ page }) => {
    await openCard(page, COMPANY);
    await page.getByRole("button", { name: "Змінити ID" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Новий ID").fill("10000");
    await expect(form.getByText("ID уже використовує клієнт", { exact: false })).toBeVisible();

    await form.getByLabel("Новий ID").fill(FREE_CODE);
    await save(page);
    await expect(page.getByText(FREE_CODE, { exact: true })).toBeVisible();

    await openTab(page, "Журнал змін");
    await expect(page.getByRole("row", { name: /Новий клієнт/ })).toBeVisible();
    await page
      .getByRole("row", { name: /Зміна ID клієнта/ })
      .getByRole("button")
      .click();
    await expect(page.getByRole("dialog").getByText(`Було: ${companyCode}`)).toBeVisible();
    await expect(page.getByRole("dialog").getByText(`Стало: ${FREE_CODE}`)).toBeVisible();

    await page.goto("/activity?action=subscriber.code_changed");
    await expect(page.getByRole("row", { name: /Зміна ID клієнта/ })).toContainText(COMPANY);
  });

  test("a tariff changes from a date, and the card keeps the versions", async ({ page }) => {
    await openCard(page, PERSON);
    await page.getByRole("button", { name: "Змінити тариф" }).click();
    await pick(page, "Тариф", OLD_TARIFF);
    await expect(page.getByRole("dialog").getByLabel("Діє з", { exact: true })).toHaveValue(
      shownDate(firstOfNextMonth(todayKyiv())),
    );
    await save(page);

    await expect(page.getByText("Тариф 1, Сервер 1", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Змінити тариф" }).click();
    await expect(page.getByRole("dialog").getByText("Попередні версії")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Тариф 1 2027", { exact: false })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click();
  });

  test("a second contact takes over as the primary one", async ({ page }) => {
    await openCard(page, COMPANY);
    await openTab(page, "Контакти");
    await expect(page.getByRole("row", { name: /Контактна Особа/ })).toContainText("Основна");

    await page.getByRole("button", { name: "Додати контакт" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("ПІБ").fill("Другий Контакт");
    await form.getByLabel("Телефон", { exact: true }).fill("+380504445566");
    await form.getByRole("radio", { name: "Email" }).check();
    await expect(form.getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-required", "true");
    await form.getByRole("textbox", { name: "Email" }).fill("contact@example.test");
    await save(page);

    await rowAction(page, "Другий Контакт", "Зробити основною");
    await page.getByRole("dialog").getByRole("button", { name: "Зробити основною" }).click();
    await expect(page.getByRole("row", { name: /Другий Контакт/ })).toContainText("Основна");
    await expect(page.getByRole("row", { name: /Контактна Особа/ })).not.toContainText("Основна");
  });

  test("one payer serves two clients, and the same tax number is a hint", async ({ page }) => {
    await createClient(page, {
      name: SECOND_COMPANY,
      type: COMPANY_TYPE,
      taxId: "87654322",
      program: PROGRAM,
      tariff: TARIFF,
      phone: "+380505556677",
    });
    await openTab(page, "Платники");
    await page.getByRole("button", { name: "Додати платника" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("ЄДРПОУ / ІПН").fill(EDRPOU);
    await expect(form.getByText(`Платник із таким номером уже є: ${COMPANY}`)).toBeVisible();
    await form.getByRole("button", { name: "Прив'язати наявного" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: COMPANY, exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Додати платника" }).click();
    await form.getByLabel("Назва або ПІБ").fill("Платник 3");
    await pick(page, "Форма оплати", "Рахунок");
    await form.getByLabel("Повна назва юрособи").fill("Платник 3 повна назва");
    let sent = 0;
    const countSent = (request: Request) => {
      if (request.method() === "POST" && request.url().includes("/payers")) sent += 1;
    };
    page.on("request", countSent);
    await pressInForm(page, "Зберегти");
    await expect(form.getByText("Вкажіть ЄДРПОУ або ІПН")).toBeVisible();
    page.off("request", countSent);
    expect(sent).toBe(0);

    await pick(page, "Форма оплати", "IBAN-реквізити");
    await form.getByLabel("Куди надсилати реквізити: телефон або пошта").fill("pay@example.test");
    await save(page);
    await expect(page.getByRole("heading", { name: "Платник 3", exact: true })).toBeVisible();

    await openCard(page, COMPANY);
    await openTab(page, "Платники");
    await expect(page.getByRole("link", { name: SECOND_COMPANY })).toBeVisible();
  });

  test("a contract with a file shows in the list as running out", async ({ page }) => {
    const today = todayKyiv();
    await openCard(page, COMPANY);
    await openTab(page, "Договори");
    await page.getByRole("button", { name: "Додати договір" }).click();
    const form = page.getByRole("dialog");
    await pick(page, "Платник", COMPANY);
    await form.getByLabel("Номер договору").fill(CONTRACT);
    await typeDate(page, "Дата підписання", shownDate(today));
    await typeDate(page, "Діє до", shownDate(addDays(today, 10)));
    await form.locator('input[type="file"]').setInputFiles({
      name: CONTRACT_FILE,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n"),
    });
    await save(page);

    const row = page.getByRole("row", { name: new RegExp(CONTRACT) });
    await expect(row).toContainText("Діючий");
    await expect(row).toContainText("Спливає");
    const file = await row.getByRole("link", { name: CONTRACT_FILE }).getAttribute("href");
    const opened = await page.request.get(file ?? "");
    expect(opened.status()).toBe(200);
    expect(opened.headers()["content-type"]).toContain("application/pdf");

    await page.goto("/contracts?expiring=true");
    await expect(page.getByRole("row", { name: new RegExp(CONTRACT) })).toContainText("Спливає");
    await page.goto("/contracts?status=expired");
    await expect(page.getByText("За цими фільтрами нічого немає")).toBeVisible();

    await openCard(page, COMPANY);
    await expect(page.getByText(shownDate(addDays(today, 10)), { exact: true }).first()).toBeVisible();
  });

  test("a client goes to the archive with what is theirs, and comes back as a package", async ({ page }) => {
    await openCard(page, STATE_CLIENT);
    await rowAction(page, STATE_CLIENT, "Архівувати");
    await page.getByRole("dialog").getByRole("button", { name: "Архівувати" }).click();
    await expect(page.getByText("В архіві", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Змінити", exact: true })).toHaveCount(0);

    await searchList(page, STATE_CLIENT);
    await expect(page.getByText("За цими фільтрами нічого немає")).toBeVisible();

    await page.goto("/archive");
    const row = page.getByRole("row", { name: new RegExp(STATE_CLIENT) });
    await row.getByRole("button", { name: "Відновити" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Відновити" }).click();
    await expect(page.getByText("В архіві поки нічого немає")).toBeVisible();

    await openCard(page, STATE_CLIENT);
    await openTab(page, "Контакти");
    await expect(page.getByRole("row", { name: /Контактна Особа/ })).toContainText("Активна");
  });

  test("the list, the card and the forms fit a phone without sideways scroll", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/subscribers");
    await expect(page.getByRole("cell").first()).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.getByRole("button", { name: "Новий клієнт" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click();

    await page
      .getByRole("row", { name: new RegExp(COMPANY) })
      .first()
      .click();
    await expect(page.getByRole("tab", { name: "Контакти" })).toBeVisible();
    await expectNoSidewaysScroll(page);
    for (const tab of ["Контакти", "Платники", "Договори", "Журнал змін"]) {
      await openTab(page, tab);
      await expectNoSidewaysScroll(page);
    }

    await page.goto("/contracts");
    await expect(page.getByRole("cell").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.goto("/id-series");
    await expect(page.getByRole("cell").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});
