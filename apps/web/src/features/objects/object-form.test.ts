import { describe, expect, it } from "vitest";
import { refuseRepeatedAddon, toObjectInput } from "./object-form";

const TARIFF = { programId: "p", tariffId: "t", ownTariffFrom: "2026-12-01" };

describe("the form of a new object as a request", () => {
  it("takes the client of the card over a field it does not have", () => {
    expect(toObjectInput({}, "client")).toMatchObject({ subscriberId: "client" });
    expect(toObjectInput({ subscriberId: "chosen" }, undefined)).toMatchObject({ subscriberId: "chosen" });
  });

  it("sends an own tariff only when the box is ticked", () => {
    expect(toObjectInput({ ...TARIFF, hasOwnTariff: true }, "c")).toMatchObject({
      ownTariff: { programId: "p", tariffId: "t", validFrom: "2026-12-01" },
    });
    expect(toObjectInput({ ...TARIFF, hasOwnTariff: false }, "c")).toMatchObject({ ownTariff: undefined });
  });

  it("wraps a sensor as a choice by number", () => {
    const sensors = [{ serialNo: "S-1", installedOn: "2026-10-01" }];
    expect(toObjectInput({ sensors }, "c")).toMatchObject({
      sensors: [{ sensor: { serialNo: "S-1" }, installedOn: "2026-10-01" }],
    });
  });

  it("sends empty lists and no note rather than nothing", () => {
    expect(toObjectInput({ note: "" }, "c")).toMatchObject({ addons: [], sensors: [], note: null });
  });
});

// П2 of the manual test of 05.11.2026: an empty row of «Додати послугу» broke the check, and antd showed its own text
describe("a service twice in the list of a new object", () => {
  it("lets an empty row by", async () => {
    await expect(refuseRepeatedAddon(null, [undefined])).resolves.toBeUndefined();
    await expect(refuseRepeatedAddon(null, [{ addonId: "a" }, undefined, {}])).resolves.toBeUndefined();
  });

  it("refuses the same service twice", async () => {
    await expect(refuseRepeatedAddon(null, [{ addonId: "a" }, { addonId: "a" }])).rejects.toThrow(
      "Ця послуга вже є в списку",
    );
  });
});
