import { describe, expect, it } from "vitest";
import { toObjectInput } from "./object-form";

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
