import { describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import { formLevelError, toDatedPrice } from "./reference-form";

describe("toDatedPrice", () => {
  it("takes the text of the form to whole kopecks", () => {
    expect(toDatedPrice("12,50", "2027-03-01")).toEqual({ amountKop: 1250, validFrom: "2027-03-01" });
  });
});

describe("formLevelError", () => {
  const FIELDS = ["name", "price"];

  it("leaves an error with a field to that field", () => {
    const named = new ApiError(409, "name_taken", "Така програма вже є", { name: "Така програма вже є" });
    expect(formLevelError(named, FIELDS)).toBeNull();
  });

  it("follows a field that goes by another name in the answer", () => {
    const named = new ApiError(409, "tariff_in_use", "Тариф уже використовується", { priceKop: "Тариф у роботі" });
    expect(formLevelError(named, FIELDS, { priceKop: "price" })).toBeNull();
  });

  it("keeps on top what this form has no field for, or nobody would see it", () => {
    const parent = new ApiError(422, "parent_unavailable", "Оберіть сервер", { serverId: "Оберіть сервер" });
    expect(formLevelError(parent, FIELDS)).toBe(parent);
  });

  it("keeps on top what has no field at all", () => {
    const plain = new ApiError(409, "version_conflict", "Запис уже змінив хтось інший");
    expect(formLevelError(plain, FIELDS)).toBe(plain);
    expect(formLevelError(new Error("network"), FIELDS)).toBeInstanceOf(Error);
  });
});
