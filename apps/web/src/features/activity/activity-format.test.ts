import { describe, expect, it } from "vitest";
import { changeSummary, entityText, formatActivityValue } from "./activity-format";

describe("formatActivityValue", () => {
  it.each([
    [null, "-"],
    [undefined, "-"],
    ["", "-"],
    [true, "Так"],
    [false, "Ні"],
    ["Олена", "Олена"],
    [3, "3"],
    [["a", "b"], '["a","b"]'],
  ])("shows %j as %s", (value, text) => {
    expect(formatActivityValue(value)).toBe(text);
  });

  it.each([
    ["priceKop", 16_000, "160,00 грн"],
    ["costKop", 1_250, "12,50 грн"],
    ["validFrom", "2027-03-01", "01.03.2027"],
    ["billingModel", "year", "Рік"],
    ["kind", "tariff", "Тариф"],
    ["sortOrder", 16_000, "16000"],
    ["name", "2027-03-01", "2027-03-01"],
  ])("reads %s the way the screen shows it", (field, value, text) => {
    expect(formatActivityValue(value, field)).toBe(text);
  });

  it("leaves a value it cannot read as it was stored", () => {
    expect(formatActivityValue("weekly", "billingModel")).toBe("weekly");
  });
});

describe("entityText", () => {
  it("names the kind and the record", () => {
    expect(entityText({ entityType: "user", entityLabel: "Олена Коваль" })).toBe("Користувач: Олена Коваль");
  });

  it("stands without a name, and without a record at all", () => {
    expect(entityText({ entityType: "user", entityLabel: null })).toBe("Користувач");
    expect(entityText({ entityType: null, entityLabel: null })).toBe("-");
  });
});

describe("changeSummary", () => {
  it("lists the fields in the people's words", () => {
    const changes = [
      { field: "fullName", before: "А", after: "Б" },
      { field: "newField", before: 1, after: 2 },
    ];
    expect(changeSummary({ changes })).toBe("ПІБ, newField");
  });

  it("is empty for a fact without changes", () => {
    expect(changeSummary({ changes: [] })).toBe("-");
  });
});
