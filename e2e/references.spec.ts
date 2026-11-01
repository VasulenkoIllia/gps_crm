import { REFERENCE_KINDS } from "@gps_crm/shared";
import { expect, test, type Page } from "@playwright/test";
import {
  ADMIN_SESSION_FILE,
  createClient,
  expectNoSidewaysScroll,
  PHONE,
  pick,
  pressInForm,
  rowAction,
  save,
  TABLET,
  typeDate,
} from "./support.ts";

const PROGRAM = "Програма А";
const SECOND_PROGRAM = "Програма Б";
const SERVER = "Сервер 1";
const SECOND_SERVER = "Сервер 2";
const TARIFF = "Тариф 1";
const NEW_TARIFF = "Тариф 1 2027";
const ADDON = "Послуга 1";
const OPERATOR = "Оператор 1";
const PAST_DATE = "01.01.2026";
const CLIENT_COUNT_COLUMN = 5;

async function openAddForm(page: Page, tab: string, label: string): Promise<void> {
  await page.goto(`/references?tab=${tab}`);
  await page.getByRole("button", { name: label }).first().click();
}

async function addNamed(page: Page, tab: string, addLabel: string, name: string): Promise<void> {
  await openAddForm(page, tab, addLabel);
  await page.getByRole("dialog").getByLabel("Назва").fill(name);
  await save(page);
  await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
}

async function addServer(page: Page, name: string): Promise<void> {
  await openAddForm(page, "servers", "Додати сервер");
  await pick(page, "Програма", PROGRAM);
  await page.getByRole("dialog").getByLabel("Назва").fill(name);
  await page.getByRole("dialog").getByLabel("Адреса").fill("https://monitoring.example.test");
  await page.getByRole("dialog").getByLabel("Собівартість ліцензії за 1 об'єкт").fill("12,50");
  await typeDate(page, "Собівартість діє з", PAST_DATE);
  await save(page);
}

async function deactivate(page: Page, tab: string, rowName: string): Promise<void> {
  await page.goto(`/references?tab=${tab}`);
  await rowAction(page, rowName, "Деактивувати");
  await save(page, "Деактивувати");
}

async function restoreFromArchive(page: Page, label: string): Promise<void> {
  const row = page.getByRole("row", { name: new RegExp(label) });
  await row.getByRole("button", { name: "Відновити" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Відновити" }).click();
}

// system.spec.ts runs next and starts from an empty archive: every package opened here is restored here
test.describe.serial("the references", () => {
  test.use({ storageState: ADMIN_SESSION_FILE });

  test("a list is typed in without leaving the form", async ({ page }) => {
    await openAddForm(page, "programs", "Додати програму");
    const form = page.getByRole("dialog");
    await form.getByLabel("Назва").fill(PROGRAM);
    await form.getByRole("button", { name: "Зберегти й додати ще" }).click();
    await expect(page.getByText("Збережено")).toBeVisible();
    await expect(form.getByLabel("Назва")).toHaveValue("");
    await expect(form.getByLabel("Назва")).toBeFocused();

    await form.getByLabel("Назва").fill(PROGRAM.toUpperCase());
    await pressInForm(page, "Зберегти");
    await expect(form.getByText("Така програма вже є")).toBeVisible();

    await form.getByLabel("Назва").fill(SECOND_PROGRAM);
    await save(page);
    await expect(page.getByRole("cell", { name: PROGRAM, exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: SECOND_PROGRAM, exact: true })).toBeVisible();
  });

  test("the rest of the references fill in", async ({ page }) => {
    await addServer(page, SERVER);
    await addServer(page, SECOND_SERVER);
    await expect(page.getByRole("row", { name: new RegExp(SERVER) })).toContainText("12,50 грн");
    await expect(page.getByRole("row", { name: new RegExp(SERVER) })).toContainText(PAST_DATE);

    await addNamed(page, "tracker-models", "Додати модель", "Модель 1");
    await addNamed(page, "sim-operators", "Додати оператора", OPERATOR);
    await addNamed(page, "contractors", "Додати підрядника", "Підрядник 1");
    await addNamed(page, "disconnect-reasons", "Додати причину", "Причина 1");

    await openAddForm(page, "sim-plans", "Додати тариф оператора");
    await pick(page, "Оператор", OPERATOR);
    await page.getByRole("dialog").getByLabel("Назва").fill("План 1");
    await pressInForm(page, "Зберегти й додати ще");
    await expect(page.getByRole("row", { name: /План 1/ })).toContainText(OPERATOR);

    // The operator stays for the next plan, and that is no unsaved work to ask about
    await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("a tariff offers only the servers of its program", async ({ page }) => {
    await openAddForm(page, "tariffs", "Додати тариф");
    const form = page.getByRole("dialog");
    await pick(page, "Програма", SECOND_PROGRAM);
    await form.getByRole("combobox", { name: "Сервер" }).click();
    await expect(page.getByRole("option", { name: SERVER })).toHaveCount(0);
    await form.getByRole("combobox", { name: "Сервер" }).press("Escape");

    await pick(page, "Програма", PROGRAM);
    await pick(page, "Сервер", SERVER);
    await form.getByLabel("Назва").fill(TARIFF);
    await form.getByLabel("Ціна за період").fill("150");
    await save(page);
    await expect(page.getByRole("row", { name: new RegExp(TARIFF) })).toContainText("150,00 грн");
  });

  test("a tariff nobody chose yet takes a corrected price", async ({ page }) => {
    await page.goto("/references?tab=tariffs");
    await rowAction(page, TARIFF, "Змінити");
    await page.getByRole("dialog").getByLabel("Ціна за період").fill("165,50");
    await save(page);
    await expect(page.getByRole("row", { name: new RegExp(TARIFF) })).toContainText("165,50 грн");
  });

  test("a chosen tariff is not rewritten, even from a form opened before", async ({ page, context }) => {
    await page.goto("/references?tab=tariffs");
    await rowAction(page, TARIFF, "Змінити");
    const form = page.getByRole("dialog");
    await form.getByLabel("Ціна за період").fill("170");

    const clientPage = await context.newPage();
    await createClient(clientPage, { name: "Клієнт тарифу", program: PROGRAM, tariff: new RegExp(`^${TARIFF},`) });
    await clientPage.close();
    await pressInForm(page, "Зберегти");
    await expect(form.getByText("Тариф уже використовується", { exact: false }).first()).toBeVisible();

    await page.reload();
    const row = page.getByRole("row", { name: new RegExp(TARIFF) });
    await expect(row).toContainText("165,50 грн");
    await expect(row.getByRole("cell").nth(CLIENT_COUNT_COLUMN)).toHaveText("1");
    await rowAction(page, TARIFF, "Змінити");
    await expect(form.getByLabel("Ціна за період")).toBeDisabled();
    await expect(form.getByRole("combobox", { name: "Програма" })).toBeDisabled();
    await expect(form.getByLabel("Назва")).toBeEnabled();
  });

  test("a new price is a new tariff, and the old one stays as it was", async ({ page }) => {
    await page.goto("/references?tab=tariffs");
    await rowAction(page, TARIFF, "Нова версія тарифу");
    const form = page.getByRole("dialog");
    await form.getByLabel("Назва нового тарифу").fill(NEW_TARIFF);
    await form.getByLabel("Нова ціна за період").fill("180");
    await save(page, "Створити тариф");

    await expect(page.getByRole("row", { name: new RegExp(NEW_TARIFF) })).toContainText("180,00 грн");
    await expect(page.getByRole("row", { name: /Тариф 1.*165,50/ })).toBeVisible();
  });

  test("an addon's price goes forward by date, never back", async ({ page }) => {
    await openAddForm(page, "addons", "Додати послугу");
    const form = page.getByRole("dialog");
    await form.getByLabel("Назва").fill(ADDON);
    await pick(page, "Для яких програм", PROGRAM);
    await pick(page, "Для яких програм", SECOND_PROGRAM);
    await form.getByLabel("Ціна за місяць").fill("50");
    await typeDate(page, "Діє з", PAST_DATE);
    await save(page);
    const row = page.getByRole("row", { name: new RegExp(ADDON) });
    await expect(row).toContainText(`${PROGRAM}, ${SECOND_PROGRAM}`);
    await expect(row).toContainText("50,00 грн");

    await rowAction(page, ADDON, "Нова ціна");
    await form.getByLabel("Ціна за місяць").fill("60");
    await save(page, "Додати");
    await expect(row).toContainText("60,00 грн з ");

    await rowAction(page, ADDON, "Нова ціна");
    await form.getByLabel("Ціна за місяць").fill("70");
    await typeDate(page, "Діє з", "02.01.2026");
    await pressInForm(page, "Додати");
    await expect(form.getByText("Нова ціна не може діяти раніше за чинну")).toBeVisible();
    await form.getByRole("button", { name: "Скасувати" }).click();
    await page
      .getByRole("dialog", { name: "Закрити без збереження?" })
      .getByRole("button", { name: "Закрити", exact: true })
      .click();

    await rowAction(page, ADDON, "Історія цін");
    await expect(page.getByRole("dialog").getByText(PAST_DATE)).toBeVisible();
    await expect(page.getByRole("dialog").getByText("50,00 грн")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("(чинна)")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("(запланована)")).toBeVisible();
  });

  test("a deactivated program takes its servers and tariffs along, and leaves the choice", async ({ page }) => {
    await deactivate(page, "servers", SECOND_SERVER);
    await deactivate(page, "programs", PROGRAM);

    await page.goto("/references?tab=tariffs&status=inactive");
    await expect(page.getByRole("row", { name: new RegExp(NEW_TARIFF) })).toContainText("Деактивований");
    await expect(page.getByRole("button", { name: `Дії: ${NEW_TARIFF}`, exact: true })).toHaveCount(0);
    await page.goto("/references?tab=tariffs&status=active");
    await expect(page.getByText("За цими фільтрами нічого немає")).toBeVisible();

    await openAddForm(page, "tariffs", "Додати тариф");
    await page.getByRole("dialog").getByRole("combobox", { name: "Програма" }).click();
    await expect(page.getByRole("option", { name: SECOND_PROGRAM })).toBeVisible();
    await expect(page.getByRole("option", { name: PROGRAM, exact: true })).toHaveCount(0);
  });

  test("the archive brings a package back, parents first", async ({ page }) => {
    await page.goto("/archive");
    await restoreFromArchive(page, `Сервер: ${SECOND_SERVER}`);
    await expect(page.getByText(`Спочатку відновіть запис «Програма: ${PROGRAM}»`)).toBeVisible();

    await restoreFromArchive(page, `Програма: ${PROGRAM}`);
    await expect(page.getByText("Записи відновлено")).toBeVisible();
    await restoreFromArchive(page, `Сервер: ${SECOND_SERVER}`);
    await expect(page.getByText("В архіві поки нічого немає")).toBeVisible();

    await page.goto("/references?tab=tariffs&status=active");
    await expect(page.getByRole("cell", { name: NEW_TARIFF, exact: true })).toBeVisible();
    await page.goto("/references?tab=servers&status=inactive");
    await expect(page.getByText("За цими фільтрами нічого немає")).toBeVisible();
  });

  test("the journal shows what happened to the references, in people's words", async ({ page }) => {
    await page.goto("/activity?action=reference.tariff_version_created");
    await page
      .getByRole("row", { name: /Нова версія тарифу/ })
      .getByRole("button")
      .click();
    const details = page.getByRole("dialog");
    await expect(details.getByText("180,00 грн")).toBeVisible();
    await expect(details.getByText(TARIFF, { exact: true })).toBeVisible();

    await page.goto("/activity?action=record.archived");
    await expect(page.getByRole("row", { name: new RegExp(`Програма: ${PROGRAM}`) })).toBeVisible();
    await page.goto("/activity?action=reference.restored");
    await expect(page.getByRole("row", { name: new RegExp(`Тариф: ${NEW_TARIFF}`) })).toBeVisible();
  });

  for (const [device, size] of [
    ["phone", PHONE],
    ["tablet", TABLET],
  ] as const) {
    test(`every list fits a ${device} without sideways scroll`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const kind of REFERENCE_KINDS) {
        await page.goto(`/references?tab=${kind}`);
        await expect(page.getByRole("heading", { name: "Довідники", exact: true })).toBeVisible();
        await expect(page.getByRole("cell").first()).toBeVisible();
        await expectNoSidewaysScroll(page);
      }
    });
  }
});
