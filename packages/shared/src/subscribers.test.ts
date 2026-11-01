import { describe, expect, it } from "vitest";
import { firstOfNextMonth, todayKyiv } from "./dates.ts";
import {
  deriveSubscriberStatus,
  discountTextSchema,
  isTariffDateAllowed,
  paymentFormat,
  subscriberCodeSchema,
  subscriberCreateSchema,
  subscriberListQuerySchema,
  subscriberUpdateSchema,
} from "./subscribers.ts";

const ID = "019a0000-0000-7000-8000-000000000001";
const today = todayKyiv();

const form = (fields: object = {}) => ({
  type: "B2C",
  name: "Клієнт",
  crmUrl: "https://crm.example.test/1",
  graceDays: 0,
  programId: ID,
  tariffId: ID,
  tariffValidFrom: firstOfNextMonth(today),
  contact: { fullName: "Контакт", phone: "0671234567", channel: "email", email: "a@example.test" },
  payer: { paymentMethod: "iban", detailsContact: "0671234567" },
  ...fields,
});

const problemsOf = (fields: object) =>
  Object.fromEntries(
    (subscriberCreateSchema.safeParse(form(fields)).error?.issues ?? []).map((issue) => [
      issue.path.join("."),
      issue.message,
    ]),
  );

describe("client status", () => {
  it.each([
    [0, 0, 0, "disconnected"],
    [0, 0, 3, "disconnected"],
    [0, 2, 3, "suspended"],
    [1, 2, 3, "partially_suspended"],
    [1, 0, 3, "active"],
  ])(
    "active %i, suspended %i, disconnected %i reads %s",
    (objectsActive, objectsSuspended, objectsDisconnected, label) => {
      expect(deriveSubscriberStatus({ objectsActive, objectsSuspended, objectsDisconnected })).toBe(label);
    },
  );
});

describe("payment format", () => {
  it.each([
    [0, "Передплата"],
    [1, "Відстрочка 1 день"],
    [3, "Відстрочка 3 дні"],
    [5, "Відстрочка 5 днів"],
    [11, "Відстрочка 11 днів"],
    [21, "Відстрочка 21 день"],
  ])("%i days read %s", (days, text) => {
    expect(paymentFormat(days)).toBe(text);
  });
});

describe("date of a tariff", () => {
  it("allows the past, today and the first of the next month, and nothing else ahead", () => {
    expect(isTariffDateAllowed("2026-01-15", "2026-11-10")).toBe(true);
    expect(isTariffDateAllowed("2026-11-10", "2026-11-10")).toBe(true);
    expect(isTariffDateAllowed("2026-12-01", "2026-11-10")).toBe(true);
    expect(isTariffDateAllowed("2026-11-11", "2026-11-10")).toBe(false);
    expect(isTariffDateAllowed("2027-01-01", "2026-11-10")).toBe(false);
  });
});

describe("the form of a client", () => {
  it("takes a person with a phone and a way to send details", () => {
    expect(problemsOf({})).toEqual({});
  });

  it("wants a tax number from a company", () => {
    expect(problemsOf({ type: "B2B" }).taxId).toBe("Вкажіть ЄДРПОУ або ІПН");
    expect(
      problemsOf({ type: "B2G", taxId: "12345678", payer: { paymentMethod: "iban", detailsContact: "0671234567" } }),
    ).toEqual({});
  });

  it("asks for the fields of the form of payment", () => {
    const payer = { paymentMethod: "vchasno" };
    expect(problemsOf({ payer })).toMatchObject({
      taxId: "Вкажіть ЄДРПОУ або ІПН",
      "payer.legalName": "Вкажіть повну назву юрособи для рахунку",
      "payer.vchasnoEmail": "Вкажіть пошту для відправки у «Вчасно»",
    });
    expect(problemsOf({ payer: { paymentMethod: "iban" } })).toMatchObject({
      "payer.detailsContact": "Вкажіть телефон або пошту, куди надсилати реквізити",
    });
  });

  it("asks for the identifier of the channel", () => {
    const contact = { fullName: "Контакт", phone: "0671234567", channel: "telegram" };
    expect(problemsOf({ contact })).toEqual({
      "contact.telegramChatId": "Для каналу Telegram потрібен Chat ID з CRM",
    });
  });

  it("wants the link with its scheme", () => {
    expect(problemsOf({ crmUrl: "crm.example.test" }).crmUrl).toBe(
      "Вставте повне посилання з CRM, наприклад https://…",
    );
  });

  it("does not take a tariff date ahead of the rule", () => {
    expect(problemsOf({ tariffValidFrom: "2099-01-01" }).tariffValidFrom).toBeTruthy();
  });

  it("wants the whole record on a change", () => {
    const issues = subscriberUpdateSchema.safeParse({ type: "B2C", name: "Клієнт", version: 1 }).error?.issues ?? [];
    expect(issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["crmUrl", "taxId", "managerId", "graceDays", "discountKop", "legacyCode", "note"]),
    );
  });
});

describe("the ID typed by hand", () => {
  it.each(["10000", "1234567890"])("takes %s", (code) => {
    expect(subscriberCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(["9999", "1234", "12a45", "", "1234567890123456", "00123", "012345"])("refuses %s", (code) => {
    expect(subscriberCodeSchema.safeParse(code).error?.issues[0]?.message).toBe(
      "ID складається лише з цифр, не менше 5",
    );
  });
});

describe("the discount in a form", () => {
  it("takes zero and a sum with kopecks", () => {
    expect(discountTextSchema.safeParse("0").success).toBe(true);
    expect(discountTextSchema.safeParse("120,50").success).toBe(true);
  });

  it("refuses a negative sum", () => {
    expect(discountTextSchema.safeParse("-1").error?.issues[0]?.message).toBe("Знижка не може бути від'ємною");
  });
});

describe("the query of the list", () => {
  it("does not let text into a numeric sort", () => {
    const cursor = `abc_${ID}`;
    expect(subscriberListQuerySchema.safeParse({ sort: "code", cursor }).success).toBe(false);
    expect(subscriberListQuerySchema.safeParse({ sort: "name", cursor }).success).toBe(true);
  });
});
