import { addDays, firstOfNextMonth, todayKyiv } from "@gps_crm/shared";
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
const OTHER_PROGRAM = "Програма Б";
const TARIFF = /^Тариф 1 2027,/;
const OTHER_TARIFF = /^Тариф 1,/;
const CLIENT = "Клієнт з об'єктами";
const OBJECT = "Об'єкт 1";
const SECOND_OBJECT = "Об'єкт 2";
const MODEL = "Модель 1";
const CONTRACTOR = "Підрядник 1";
const REASON = "Причина 1";
const OPERATOR = "Оператор 1";
const PLAN = "План 1";
const ADDON = "Послуга 1";
const IMEI = "356938035643809";
const NEW_IMEI = "356938035643817";
const SPARE_IMEI = "356938035643825";
const ICCID = "8938003990000000011";
const NEW_ICCID = "8938003990000000029";
const SIM_PHONE = "+380671234567";
const SENSOR = "SENSOR-1";

const TODAY = todayKyiv();
const MONTH_AGO = addDays(TODAY, -30);
const WEEK_AGO = addDays(TODAY, -7);
const shownDate = (date: string) => date.split("-").reverse().join(".");

async function fillNewObject(page: Page, name: string, imei: string, iccid: string): Promise<void> {
  const form = page.getByRole("dialog");
  await form.getByLabel("IMEI").fill(imei);
  await typeDate(page, "Дата встановлення", shownDate(WEEK_AGO));
  await pick(page, "Підрядник", CONTRACTOR);
  await form.getByLabel("Назва").fill(name);
  await typeDate(page, "Статус діє з", shownDate(MONTH_AGO));
  await form.getByLabel("ICCID").fill(iccid);
  await typeDate(page, "Дата підключення", shownDate(MONTH_AGO));
}

async function leaveForm(page: Page): Promise<void> {
  await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).first().click();
  await page.getByRole("dialog", { name: "Закрити без збереження?" }).getByRole("button", { name: "Закрити" }).click();
}

async function openObject(page: Page, name: string): Promise<void> {
  await page.goto("/objects");
  await page.getByLabel("Пошук").fill(name);
  await page.getByRole("row", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function changeStatus(page: Page, status: string, date: string, reason?: string): Promise<void> {
  await page.getByRole("button", { name: "Змінити статус" }).click();
  await pick(page, "Статус", status);
  await typeDate(page, "Діє з", shownDate(date));
  if (reason) await pick(page, "Причина відключення", reason);
  await save(page);
  await expect(page.getByRole("main").getByText(status, { exact: true }).first()).toBeVisible();
}

// system.spec.ts runs next and starts from an empty archive: every package opened here is restored here
test.describe.serial("the objects and the equipment", () => {
  test.use({ storageState: ADMIN_SESSION_FILE });

  test("a tracker is registered into the stock before any object needs it", async ({ page }) => {
    await createClient(page, { name: CLIENT, program: PROGRAM, tariff: TARIFF, validFrom: firstOfNextMonth(TODAY) });

    await page.goto("/equipment");
    await page.getByRole("button", { name: "Новий трекер" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("IMEI").fill(IMEI);
    await pick(page, "Модель", MODEL);
    await pick(page, "Власність", "Оренда");
    await save(page);
    await expect(page.getByRole("row", { name: new RegExp(IMEI) })).toContainText("Знято");

    await page.getByRole("button", { name: "Новий трекер" }).click();
    await form.getByLabel("IMEI").fill(IMEI);
    await expect(form.getByText("Такий номер уже є")).toBeVisible();
    await pressInForm(page, "Зберегти");
    await expect(form.getByText("Трекер з таким IMEI уже є")).toBeVisible();
    await leaveForm(page);
  });

  test("a client gets an object with a tracker from the stock and a new SIM", async ({ page }) => {
    await page.goto("/subscribers");
    await page.getByLabel("Пошук").fill(CLIENT);
    await page.getByRole("row", { name: new RegExp(CLIENT) }).click();
    // The only payer is filled in on every opening, not just the first
    await page.getByRole("button", { name: "Додати об'єкт" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).first().click();
    await page.getByRole("button", { name: "Додати об'єкт" }).click();
    const form = page.getByRole("dialog");
    await fillNewObject(page, OBJECT, IMEI, ICCID);
    await expect(form.getByText("Цей запис уже є і вільний: його й буде встановлено")).toBeVisible();
    await expect(form.getByLabel("Модель")).toHaveCount(0);
    await form.getByLabel("Номер").fill(SIM_PHONE);
    await pick(page, /^Оператор/, OPERATOR);
    await pick(page, "Тариф оператора", PLAN);
    await form.getByRole("button", { name: "Додати послугу" }).click();
    await pick(page, "Послуга", ADDON);
    // A service belongs to a program: another program takes it off the form
    await form.getByLabel("Свій тариф об'єкта").check();
    await expect(form.getByRole("combobox", { name: "Послуга" })).toHaveCount(1);
    await pick(page, "Програма", OTHER_PROGRAM);
    await expect(form.getByRole("combobox", { name: "Послуга" })).toHaveCount(0);
    await form.getByLabel("Свій тариф об'єкта").uncheck();
    await form.getByRole("button", { name: "Додати послугу" }).click();
    await pick(page, "Послуга", ADDON);
    await pressInForm(page, "Створити");
    await expect(page.getByRole("heading", { name: OBJECT, exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(CLIENT);
    await expect(page.getByRole("main")).toContainText(IMEI);
    await expect(page.getByRole("main")).toContainText(shownDate(WEEK_AGO));
    await expect(page.getByRole("main")).toContainText(CONTRACTOR);

    await page.getByRole("tab", { name: "Послуги" }).click();
    await expect(page.getByRole("row", { name: new RegExp(ADDON) })).toBeVisible();

    await page.goto("/equipment");
    await expect(page.getByRole("row", { name: new RegExp(IMEI) })).toContainText(OBJECT);
    await expect(page.getByRole("row", { name: new RegExp(IMEI) })).toContainText(CONTRACTOR);
    await page.getByRole("tab", { name: "SIM-картки" }).click();
    await expect(page.getByRole("row", { name: new RegExp(ICCID) })).toContainText(OBJECT);
  });

  test("a form says a tracker is taken, with a way to its object", async ({ page }) => {
    await page.goto("/objects");
    await page.getByRole("button", { name: "Новий об'єкт" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("IMEI").fill(IMEI);
    await expect(form.getByText(`Уже встановлено: ${OBJECT}`)).toBeVisible();
    await expect(form.getByRole("link", { name: "Відкрити об'єкт" })).toBeVisible();
    await leaveForm(page);
  });

  test("an object is found by the last digits of its IMEI, and so is its client", async ({ page }) => {
    await page.goto("/objects");
    await page.getByLabel("Пошук").fill(IMEI.slice(-6));
    await expect(page.getByRole("row", { name: new RegExp(OBJECT) })).toBeVisible();
    await page.getByLabel("Пошук").fill("000000");
    await expect(page.getByRole("row", { name: new RegExp(OBJECT) })).toHaveCount(0);

    await page.goto("/subscribers");
    await page.getByLabel("Пошук").fill(IMEI.slice(-6));
    await expect(page.getByRole("row", { name: new RegExp(CLIENT) })).toBeVisible();
    await page.getByLabel("Пошук").fill(ICCID);
    await expect(page.getByRole("row", { name: new RegExp(CLIENT) })).toBeVisible();
  });

  test("an object is suspended and comes back, and a disconnect asks why", async ({ page }) => {
    await openObject(page, OBJECT);
    await changeStatus(page, "Призупинений", addDays(TODAY, -3));
    await changeStatus(page, "Активний", addDays(TODAY, -2));

    await page.getByRole("tab", { name: "Історія" }).click();
    await expect(page.getByRole("row", { name: /Призупинений/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Активний/ })).toHaveCount(2);
  });

  test("an object goes on a tariff of its own, and the card keeps the version", async ({ page }) => {
    await openObject(page, OBJECT);
    await expect(page.getByRole("main")).toContainText("(тариф клієнта)");
    await page.getByRole("button", { name: "Тариф об'єкта" }).click();
    await page.getByRole("dialog").getByText("Свій тариф", { exact: true }).click();
    await pick(page, "Програма", PROGRAM);
    await pick(page, "Тариф", OTHER_TARIFF);
    await typeDate(page, "Діє з", shownDate(firstOfNextMonth(TODAY)));
    await save(page);
    await expect(page.getByRole("main")).toContainText("Наступний тариф");
    await expect(page.getByRole("main")).toContainText(`${shownDate(firstOfNextMonth(TODAY))}`);

    await page.getByRole("tab", { name: "Історія" }).click();
    await expect(
      page.getByRole("row", { name: new RegExp(`Тариф 1.*${shownDate(firstOfNextMonth(TODAY))}`) }),
    ).toBeVisible();
  });

  test("a new tracker takes over the SIM, and the old one stays in the history", async ({ page }) => {
    await openObject(page, OBJECT);
    await page.getByRole("button", { name: "Замінити трекер" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("IMEI").fill(NEW_IMEI);
    await pick(page, "Модель", MODEL);
    await typeDate(page, "Дата встановлення", shownDate(addDays(TODAY, -1)));
    await pick(page, "Підрядник", CONTRACTOR);
    await save(page);
    await expect(page.getByRole("main")).toContainText(NEW_IMEI);
    await expect(page.getByRole("main")).toContainText(ICCID);

    await page.getByRole("tab", { name: "Історія" }).click();
    await expect(page.getByRole("row", { name: new RegExp(IMEI) }).first()).toContainText(
      shownDate(addDays(TODAY, -1)),
    );
    await expect(page.getByRole("row", { name: new RegExp(NEW_IMEI) }).first()).toBeVisible();

    await page.goto("/equipment");
    await expect(page.getByRole("row", { name: new RegExp(IMEI) })).toContainText("Знято");
    await page.getByRole("button", { name: IMEI, exact: true }).click();
    const card = page.getByRole("dialog");
    await expect(card.getByRole("row", { name: new RegExp(OBJECT) })).toContainText(shownDate(WEEK_AGO));
    await page.keyboard.press("Escape");
  });

  test("a SIM and a sensor change on the tab of the equipment", async ({ page }) => {
    await openObject(page, OBJECT);
    await page.getByRole("button", { name: "Замінити SIM" }).click();
    await page.getByRole("dialog").getByLabel("ICCID").fill(NEW_ICCID);
    await save(page);
    await expect(page.getByRole("main")).toContainText(NEW_ICCID);

    await page.getByRole("button", { name: "Додати датчик" }).click();
    await page.getByRole("dialog").getByLabel("Серійний номер").fill(SENSOR);
    await save(page);
    await expect(page.getByRole("row", { name: new RegExp(SENSOR) })).toBeVisible();
    await rowAction(page, `Датчик ${SENSOR}`, "Зняти");
    await save(page);
    await expect(page.getByRole("row", { name: new RegExp(SENSOR) })).toHaveCount(0);
  });

  test("a client with a working object does not go to the archive, and a payer stays", async ({ page }) => {
    await page.goto("/subscribers");
    await page.getByLabel("Пошук").fill(CLIENT);
    await page.getByRole("row", { name: new RegExp(CLIENT) }).click();
    await rowAction(page, CLIENT, "Архівувати");
    await page.getByRole("dialog").getByRole("button", { name: "Архівувати" }).click();
    await expect(page.getByText(/об'єкт/).first()).toBeVisible();
  });

  test("a disconnected object leaves for the archive and frees what stood on it", async ({ page }) => {
    await openObject(page, OBJECT);
    await changeStatus(page, "Відключений", TODAY, REASON);
    await expect(page.getByRole("main")).toContainText(REASON);
    await rowAction(page, OBJECT, "Архівувати");
    await page.getByRole("dialog").getByRole("button", { name: "Архівувати" }).click();
    await expect(page.getByRole("main")).toContainText("В архіві");

    await page.goto("/equipment");
    await expect(page.getByRole("row", { name: new RegExp(NEW_IMEI) })).toContainText("Знято");

    await page.goto("/archive");
    await expect(page.getByRole("row", { name: new RegExp(OBJECT) })).toBeVisible();
    await page.goto("/objects?archived=true");
    await page.getByRole("row", { name: new RegExp(OBJECT) }).click();
    await rowAction(page, OBJECT, "Відновити");
    await page.getByRole("dialog").getByRole("button", { name: "Відновити" }).click();
    await expect(page.getByRole("button", { name: "Встановити трекер" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Змінити статус" })).toHaveCount(0);

    await page.getByRole("button", { name: "Встановити трекер" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("IMEI").fill(SPARE_IMEI);
    await pick(page, "Модель", MODEL);
    await form.getByLabel("ICCID").fill(ICCID);
    await save(page);
    await changeStatus(page, "Активний", TODAY);
    await expect(page.getByRole("main")).toContainText(SPARE_IMEI);
  });

  test("a second object of the same day is typed without starting over", async ({ page }) => {
    await page.goto("/objects");
    await page.getByRole("button", { name: "Новий об'єкт" }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Клієнт").click();
    await form.getByLabel("Клієнт").fill(CLIENT);
    await page.getByRole("option", { name: new RegExp(CLIENT) }).click();
    await fillNewObject(page, SECOND_OBJECT, "356938035643833", "8938003990000000037");
    await pick(page, "Модель", MODEL);
    await pressInForm(page, "Створити й додати ще");
    await expect(page.getByText("Об'єкт створено")).toBeVisible();
    await expect(form.getByLabel("Назва")).toHaveValue("");
    await expect(form.getByLabel("IMEI")).toHaveValue("");
    await expect(form).toContainText(CLIENT);
    await expect(form).toContainText(CONTRACTOR);
    await form.getByRole("button", { name: "Скасувати" }).click();
    await page.getByLabel("Пошук").fill(SECOND_OBJECT);
    await page.getByRole("row", { name: new RegExp(SECOND_OBJECT) }).click();
    await expect(page.getByRole("heading", { name: SECOND_OBJECT, exact: true })).toBeVisible();
    await rowAction(page, SECOND_OBJECT, "Видалити");
    await page.getByRole("dialog").getByRole("button", { name: "Видалити" }).click();
    await expect(page.getByRole("heading", { name: "Об'єкти" })).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(SECOND_OBJECT) })).toHaveCount(0);
  });

  for (const [device, size] of [
    ["phone", PHONE],
    ["tablet", TABLET],
  ] as const) {
    test(`the objects and the equipment fit a ${device} without sideways scroll`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/objects");
      await expect(page.getByRole("cell").first()).toBeVisible();
      await expectNoSidewaysScroll(page);

      await page.getByRole("button", { name: "Новий об'єкт" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoSidewaysScroll(page);
      await page.getByRole("dialog").getByRole("button", { name: "Скасувати" }).click();

      await page.getByRole("row", { name: new RegExp(OBJECT) }).click();
      await expect(page.getByRole("tab", { name: "Обладнання" })).toBeVisible();
      for (const tab of ["Обладнання", "Послуги", "Історія", "Журнал змін"]) {
        await page.getByRole("tab", { name: tab }).click();
        await expectNoSidewaysScroll(page);
      }

      await page.goto("/equipment");
      await expect(page.getByRole("cell").first()).toBeVisible();
      for (const tab of ["Трекери", "SIM-картки", "Датчики"]) {
        await page.getByRole("tab", { name: tab }).click();
        await expectNoSidewaysScroll(page);
      }
    });
  }
});
