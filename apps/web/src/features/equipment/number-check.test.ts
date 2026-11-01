import type { EquipmentCheck } from "@gps_crm/shared";
import { describe, expect, it } from "vitest";
import { hintOf, isFreeRecord } from "./number-check";

const unknown: EquipmentCheck = { isValid: true, isFree: true, hasChecksumWarning: false, holder: null };
const stock: EquipmentCheck = {
  isValid: true,
  isFree: false,
  hasChecksumWarning: false,
  holder: { id: "1", isArchived: false, objectId: null, label: "" },
};
const installed: EquipmentCheck = {
  ...stock,
  holder: { id: "1", isArchived: false, objectId: "2", label: "Об'єкт 1" },
};
const archived: EquipmentCheck = {
  ...stock,
  holder: { id: "1", isArchived: true, objectId: null, label: "" },
};

describe("the hint under a number", () => {
  it("stays quiet until the number makes sense", () => {
    expect(hintOf(undefined, true)).toBeNull();
    expect(hintOf({ ...unknown, isValid: false }, true)).toBeNull();
    expect(hintOf(unknown, true)).toBeNull();
  });

  it("warns about a check digit on a number nobody has", () => {
    expect(hintOf({ ...unknown, hasChecksumWarning: true }, true)?.type).toBe("warning");
  });

  it("calls a free record good news on an object and a clash on the form of the equipment", () => {
    expect(hintOf(stock, true)?.type).toBe("info");
    expect(hintOf(stock, false)).toEqual({ type: "warning", text: "Такий номер уже є" });
  });

  it("leads to the object a record stands on", () => {
    expect(hintOf(installed, true)).toMatchObject({ objectId: "2", text: "Уже встановлено: Об'єкт 1" });
  });

  it("sends an archived record to the archive", () => {
    expect(hintOf(archived, true)?.text).toBe("Цей запис в архіві: спершу відновіть його");
  });
});

describe("a record in the stock", () => {
  it("is one that is neither installed nor archived", () => {
    expect(isFreeRecord(stock)).toBe(true);
    expect(isFreeRecord(installed)).toBe(false);
    expect(isFreeRecord(archived)).toBe(false);
    expect(isFreeRecord(unknown)).toBe(false);
    expect(isFreeRecord(undefined)).toBe(false);
  });
});
