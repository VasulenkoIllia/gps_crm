import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_SESSION_FILE, createClient, expectNoSidewaysScroll, PHONE } from "./support.ts";

// What subscribers_objects.spec.ts leaves behind: an active object with this tracker on it
const OBJECT = "Об'єкт 1";
const OBJECT_IMEI = "356938035643825";
const CLIENT = "Клієнт для пошуку";
const CLIENT_PHONE = "+380939876543";
const PROGRAM = "Програма А";
const TARIFF = /^Тариф 1 2027,/;
// The worker takes a task within its polling interval, then the screen asks every 1.5 s
const EXPORT_TIMEOUT_MS = 60_000;

const headerSearch = (page: Page) => page.locator(".app-header").getByLabel("Пошук по системі");

async function typeInHeader(page: Page, text: string): Promise<void> {
  await headerSearch(page).click();
  await headerSearch(page).fill(text);
}

test.describe.serial("the search, the home page and the export", () => {
  test.use({ storageState: ADMIN_SESSION_FILE });

  test("the header finds an object by the last digits of its IMEI", async ({ page }) => {
    await page.goto("/objects");
    await typeInHeader(page, OBJECT_IMEI.slice(-6));
    await expect(page.getByRole("option", { name: new RegExp(`^IMEI ${OBJECT_IMEI}`) })).toBeVisible();
    await page.getByRole("option", { name: new RegExp(`^${OBJECT}`) }).click();
    await expect(page.getByRole("heading", { name: OBJECT, exact: true })).toBeVisible();
    await expect(headerSearch(page)).toHaveValue("");
  });

  test("the header finds a client by the last digits of a phone, and Enter opens all results", async ({ page }) => {
    await createClient(page, { name: CLIENT, program: PROGRAM, tariff: TARIFF, phone: CLIENT_PHONE });
    const lastDigits = CLIENT_PHONE.slice(-7);
    // The line of the contact, its name and phone: the client's own line now reads «name, ID …» too
    const contactLine = new RegExp(`^${CLIENT} \\+380`);

    await page.goto("/objects");
    await typeInHeader(page, lastDigits);
    await page.getByRole("option", { name: contactLine }).click();
    await expect(page.getByRole("heading", { name: CLIENT, exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Контакти", selected: true })).toBeVisible();

    await typeInHeader(page, lastDigits);
    await expect(page.getByRole("option", { name: contactLine })).toBeVisible();
    await headerSearch(page).press("Enter");
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${lastDigits}$`));
    const contacts = page.getByRole("region", { name: "Контакти" });
    await expect(contacts.getByRole("link", { name: CLIENT, exact: true })).toBeVisible();

    await page.getByLabel("Що шукати").fill("0000000");
    await expect(page.getByText("Нічого не знайдено. Перевірте номер або назву.")).toBeVisible();
  });

  test("the home page counts the records and keeps the last ones changed", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Головна" })).toBeVisible();
    // The tiles are links now, beside the same words in the menu
    const tiles = page.getByRole("main");
    await expect(tiles.getByRole("link", { name: /^Клієнти \d+/ })).toBeVisible();
    await expect(tiles.getByRole("link", { name: /^Активні об'єкти \d+/ })).toBeVisible();
    const recent = page.getByRole("region", { name: "Мої останні записи" });
    await expect(recent.getByRole("link").first()).toHaveText(CLIENT);
    await expect(page.getByRole("link", { name: "Увесь журнал" })).toBeVisible();

    await page.getByRole("main").getByLabel("Пошук по системі").fill(OBJECT_IMEI.slice(-6));
    await page.getByRole("option", { name: new RegExp(`^${OBJECT}`) }).click();
    await expect(page.getByRole("heading", { name: OBJECT, exact: true })).toBeVisible();
  });

  test("a filtered list goes to Excel, and the journal keeps who took it", async ({ page }) => {
    const query = OBJECT_IMEI.slice(-6);
    await page.goto(`/objects?q=${query}`);
    await expect(page.getByRole("row", { name: new RegExp(OBJECT) })).toBeVisible();

    const download = page.waitForEvent("download", { timeout: EXPORT_TIMEOUT_MS });
    await page.getByRole("button", { name: "Excel" }).click();
    await expect(page.getByRole("button", { name: /Готую файл/ })).toBeVisible();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^Об'єкти \d{2}\.\d{2}\.\d{4}\.xlsx$/);
    await expect(page.getByText("Об'єкти: файл готовий, рядків: 1. Він зберігається 24 години.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Завантажити" })).toBeVisible();

    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await file.path());
    const sheet = book.getWorksheet("Об'єкти");
    expect(sheet?.rowCount).toBe(2);
    expect(sheet?.getRow(2).values).toContain(OBJECT);

    await page.goto("/activity?action=export.completed");
    const row = page.getByRole("row", { name: /Експорт в Excel/ });
    await expect(row).toHaveCount(1);
    await row.getByRole("button").click();
    const details = page.getByRole("dialog");
    await expect(details).toContainText("Об'єкти");
    await expect(details).toContainText(`Пошук: «${query}»`);
    await page.keyboard.press("Escape");

    await page.goto("/activity?action=export.downloaded");
    await expect(page.getByRole("row", { name: /Скачування експорту/ })).toHaveCount(1);
  });

  test("the home page and the search fit a phone, and the header leads to the search", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Головна" })).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.goto("/objects");
    await page.getByRole("button", { name: "Відкрити пошук" }).click();
    await expect(page).toHaveURL(/\/search$/);
    await page.getByLabel("Що шукати").fill(OBJECT_IMEI.slice(-6));
    const objects = page.getByRole("region", { name: "Об'єкти" });
    await expect(objects.getByRole("link", { name: OBJECT, exact: true })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});
