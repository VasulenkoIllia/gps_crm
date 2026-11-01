import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { ADMIN_SESSION_FILE } from "./support.ts";

const NEW_NAME = "Адмін Журналу";
const JOB_TITLE = "Партиції журналу дій";
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 768, height: 1024 };

async function addArchiveBatch(label: string): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO archive_batches (id, entity_type, label, item_count) VALUES (gen_random_uuid(), 'nobody_restores', $1, 2)`,
      [label],
    );
  } finally {
    await client.end();
  }
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate<number>(
    "document.documentElement.scrollWidth - document.documentElement.clientWidth",
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// After auth.spec.ts, on its database and its administrator: step 2 has nothing of its own to sign in with
test.describe.serial("the journal, the archive and the «Система» screen", () => {
  test.use({ storageState: ADMIN_SESSION_FILE });

  test("a change of the profile shows in the journal, with before and after", async ({ page }) => {
    await page.goto("/profile");
    await page.getByLabel("ПІБ").fill(NEW_NAME);
    await page.getByRole("button", { name: "Зберегти" }).first().click();
    await expect(page.getByText("Збережено")).toBeVisible();

    await page.getByRole("link", { name: "Журнал дій" }).click();
    await page.getByRole("combobox", { name: "Дія" }).click();
    await page.getByRole("combobox", { name: "Дія" }).fill("Зміна профілю");
    await page.getByRole("option", { name: "Зміна профілю" }).click();
    await expect(page).toHaveURL(/action=user\.profile_updated/);

    const row = page.getByRole("row", { name: /Зміна профілю/ });
    await expect(row).toHaveCount(1);
    await row.getByRole("button").click();
    const details = page.getByRole("dialog");
    await expect(details.getByText("Було: Перший Адмін")).toBeVisible();
    await expect(details.getByText(`Стало: ${NEW_NAME}`)).toBeVisible();
  });

  test("the filters live in the address, and an empty result offers the way back", async ({ page }) => {
    await page.goto("/activity?from=2020-01-01&to=2020-01-02");
    await expect(page.getByText("За цими фільтрами нічого немає")).toBeVisible();

    await page.reload();
    await expect(page.getByText("За цими фільтрами нічого немає")).toBeVisible();

    await page.getByRole("button", { name: "Скинути фільтри" }).first().click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("row", { name: /Зміна профілю/ })).toBeVisible();
  });

  test("an ID that is not one is refused next to the field", async ({ page }) => {
    await page.goto("/activity");
    await page.getByRole("searchbox", { name: "ID запису" }).fill("не ідентифікатор");
    await page.getByRole("searchbox", { name: "ID запису" }).press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Це не схоже на ідентифікатор запису");
  });

  test("a reset takes one click, though leaving the field brings up its hint", async ({ page }) => {
    await page.goto("/activity?entityType=user");
    await expect(page.getByRole("row", { name: /Зміна профілю/ })).toBeVisible();
    await page.getByRole("searchbox", { name: "ID запису" }).fill("не ідентифікатор");

    await page.getByRole("button", { name: "Скинути фільтри" }).click();

    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole("searchbox", { name: "ID запису" })).toHaveValue("");
  });

  test("the system screen shows the last backup and the running version", async ({ page }) => {
    await page.goto("/system");

    const backups = page.getByRole("region", { name: "Бекапи" });
    await expect(backups.getByText("Остання резервна копія")).toBeVisible();
    await expect(backups.getByText("Бекапи в порядку")).toBeVisible();
    await expect(backups.getByText("Відновлення перевірене")).toBeVisible();

    await expect(page.getByRole("region", { name: "Версія" }).getByText("sha-e2e").first()).toBeVisible();
    await expect(page.getByRole("region", { name: "База й диск" }).getByText("Розмір бази")).toBeVisible();
    await expect(page.getByRole("region", { name: "Останні дії" }).getByText("Зміна профілю")).toBeVisible();
  });

  test("a job runs by hand, and the journal says who asked", async ({ page }) => {
    await page.goto("/system");
    await page.getByRole("button", { name: `Запустити: ${JOB_TITLE}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Запустити" }).click();
    await expect(page.getByText("Задачу поставлено в чергу")).toBeVisible();
    await expect(page.getByRole("region", { name: "Останні дії" }).getByText("Ручний запуск задачі")).toBeVisible();

    await expect(async () => {
      await page.reload();
      await page.getByRole("button", { name: `Історія: ${JOB_TITLE}` }).click();
      await expect(page.getByRole("dialog").getByText("Вручну")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
  });

  test("the archive starts empty, and a package no module brings back says so and stays", async ({ page }) => {
    await page.goto("/archive");
    await expect(page.getByText("В архіві поки нічого немає")).toBeVisible();

    await addArchiveBatch("Клієнт 10001 і пов'язані записи");
    await page.reload();
    const row = page.getByRole("row", { name: /Клієнт 10001/ });
    await row.getByRole("button", { name: "Відновити" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Відновити" }).click();

    await expect(page.getByText("Записи цього виду поки не можна відновити")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toBeVisible();
  });

  for (const [device, size] of [
    ["phone", PHONE],
    ["tablet", TABLET],
  ] as const) {
    test(`the screens of step 2 fit a ${device} without sideways scroll`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const [path, heading] of [
        ["/activity", "Журнал дій"],
        ["/archive", "Архів"],
        ["/system", "Система"],
      ] as const) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
        await expect(page.getByRole("cell").first()).toBeVisible();
        await expectNoSidewaysScroll(page);
      }
    });
  }
});
