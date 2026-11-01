import { describe, expect, it } from "vitest";
import { contactCreateSchema } from "./contacts.ts";

const form = (fields: object = {}) => ({
  fullName: "Контакт",
  phone: "0671234567",
  crmUrl: "https://crm.example.test/1",
  channel: "viber",
  viberChatId: "abc",
  ...fields,
});

describe("the form of a contact", () => {
  it("leaves the notices on by default", () => {
    expect(contactCreateSchema.parse(form())).toMatchObject({
      billingNotify: true,
      techNotify: true,
      isActive: true,
      isPrimary: false,
      phone: "+380671234567",
    });
  });

  it("takes an empty field of a form for no value", () => {
    expect(contactCreateSchema.parse(form({ phone2: "", email: "", telegramChatId: "" }))).toMatchObject({
      phone2: null,
      email: null,
      telegramChatId: null,
    });
  });

  it("wants the identifier of the chosen channel", () => {
    const problem = (fields: object) => contactCreateSchema.safeParse(form(fields)).error?.issues[0];
    expect(problem({ viberChatId: "" })).toMatchObject({
      path: ["viberChatId"],
      message: "Для каналу Viber потрібен Chat ID з CRM",
    });
    expect(problem({ channel: "email" })).toMatchObject({
      path: ["email"],
      message: "Для каналу Email вкажіть адресу",
    });
  });

  it("reads a Telegram chat as a number", () => {
    const parsed = (telegramChatId: string) =>
      contactCreateSchema.safeParse(form({ channel: "telegram", telegramChatId }));
    expect(parsed("-1001234567").success).toBe(true);
    expect(parsed("абв").error?.issues[0]?.message).toBe("Telegram Chat ID складається з цифр");
  });
});
