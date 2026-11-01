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
