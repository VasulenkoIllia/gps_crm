import { describe, expect, it } from "vitest";
import { payerCreateSchema, paymentProblems } from "./payers.ts";

describe("the form of a payer", () => {
  it("asks each form of payment for its own fields", () => {
    const fieldsOf = (paymentMethod: "invoice" | "vchasno" | "iban") =>
      paymentProblems({ paymentMethod }).map((problem) => problem.field);
    expect(fieldsOf("invoice")).toEqual(["legalName", "taxId"]);
    expect(fieldsOf("vchasno")).toEqual(["legalName", "taxId", "vchasnoEmail"]);
    expect(fieldsOf("iban")).toEqual(["detailsContact"]);
  });

  it("keeps a phone for the details in the form a search compares with", () => {
    const parsed = payerCreateSchema.parse({ name: "Платник", paymentMethod: "iban", detailsContact: "067 123 45 67" });
    expect(parsed.detailsContact).toBe("+380671234567");
  });

  it("takes an email for the details", () => {
    const parsed = payerCreateSchema.parse({
      name: "Платник",
      paymentMethod: "iban",
      detailsContact: "A@Example.test",
    });
    expect(parsed.detailsContact).toBe("a@example.test");
  });

  it("refuses what is neither", () => {
    const result = payerCreateSchema.safeParse({ name: "Платник", paymentMethod: "iban", detailsContact: "завтра" });
    expect(result.error?.issues[0]?.message).toBe("Вкажіть телефон або пошту, куди надсилати реквізити");
  });
});
