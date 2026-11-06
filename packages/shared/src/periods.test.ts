import { describe, expect, it } from "vitest";
import { isLivePeriod, periodAfter, periodOn, planVersion, valueSince } from "./periods.ts";

const TODAY = "2026-11-15";
const version = (id: string, validFrom: string, validTo: string | null = null) => ({ id, validFrom, validTo });

describe("isLivePeriod", () => {
  it("takes an empty period for a version that never was", () => {
    expect(isLivePeriod(version("a", "2026-01-01", "2026-01-01"))).toBe(false);
    expect(isLivePeriod(version("a", "2026-01-01", "2026-01-02"))).toBe(true);
    expect(isLivePeriod(version("a", "2026-01-01"))).toBe(true);
  });
});

describe("periodOn", () => {
  const history = [version("next", "2026-12-01"), version("now", "2026-02-01", "2026-12-01")];

  it("finds the period a date falls into, its end not included", () => {
    expect(periodOn(history, "2026-02-01")?.id).toBe("now");
    expect(periodOn(history, "2026-11-30")?.id).toBe("now");
    expect(periodOn(history, "2026-12-01")?.id).toBe("next");
  });

  it("finds nothing before the first one, and never an empty one", () => {
    expect(periodOn(history, "2026-01-31")).toBeNull();
    expect(periodOn([version("gone", "2026-02-01", "2026-02-01")], "2026-02-01")).toBeNull();
  });
});

// П3 of the manual test of 05.11.2026: a card took the newest version for the current one, though it had not begun
describe("periodAfter", () => {
  it("finds the version planned after a date, and none once it has begun", () => {
    const history = [version("next", "2026-12-01"), version("now", "2026-02-01", "2026-12-01")];
    expect(periodAfter(history, TODAY)?.id).toBe("next");
    expect(periodAfter(history, "2026-12-01")).toBeNull();
  });

  it("takes the earliest of the planned ones, and never an empty one", () => {
    const history = [
      version("replaced", "2027-01-01", "2027-01-01"),
      version("later", "2027-02-01"),
      version("sooner", "2026-12-01", "2027-02-01"),
    ];
    expect(periodAfter(history, TODAY)?.id).toBe("sooner");
  });
});

// D91: the list marks a tariff as planned only when the tariff itself has not begun
describe("valueSince", () => {
  const tariff = (id: string, tariffId: string, validFrom: string, validTo: string | null = null) => ({
    ...version(id, validFrom, validTo),
    tariffId,
  });
  const isSameTariff = (one: { tariffId: string }, other: { tariffId: string }) => one.tariffId === other.tariffId;

  it("takes the start of the newest version, planned or not", () => {
    const history = [tariff("next", "B", "2026-12-01"), tariff("now", "A", "2026-02-01", "2026-12-01")];
    expect(valueSince(history, isSameTariff)).toBe("2026-12-01");
  });

  it("goes back over versions that repeat the value, in any order of the input", () => {
    const history = [
      tariff("first", "A", "2026-01-01", "2026-02-01"),
      tariff("payer", "B", "2026-12-01"),
      tariff("now", "B", "2026-02-01", "2026-12-01"),
    ];
    expect(valueSince(history, isSameTariff)).toBe("2026-02-01");
  });

  it("skips an empty version and finds nothing without a live one", () => {
    const history = [tariff("gone", "B", "2026-12-01", "2026-12-01"), tariff("now", "A", "2026-02-01")];
    expect(valueSince(history, isSameTariff)).toBe("2026-02-01");
    expect(valueSince([tariff("gone", "B", "2026-12-01", "2026-12-01")], isSameTariff)).toBeNull();
  });
});

describe("planVersion", () => {
  it("closes the version in force on the new date", () => {
    expect(planVersion([version("a", "2026-01-01")], "2026-11-15", TODAY).closings).toEqual([
      { id: "a", validTo: "2026-11-15" },
    ]);
  });

  it("empties a version of the same date and one that has not begun", () => {
    const plan = planVersion(
      [version("next", "2026-12-01"), version("a", "2026-11-15", "2026-12-01")],
      "2026-11-15",
      TODAY,
    );
    expect(plan.blockedBy).toBeNull();
    expect(plan.closings).toEqual([
      { id: "next", validTo: "2026-12-01" },
      { id: "a", validTo: "2026-11-15" },
    ]);
  });

  it("refuses a date before a version that has begun", () => {
    const history = [version("b", "2026-10-01"), version("a", "2026-01-01", "2026-10-01")];
    expect(planVersion(history, "2026-09-01", TODAY).blockedBy?.id).toBe("b");
  });

  it("leaves alone what ended before the new date", () => {
    const history = [version("b", "2026-10-01"), version("a", "2026-01-01", "2026-10-01")];
    expect(planVersion(history, "2026-10-05", TODAY).closings).toEqual([{ id: "b", validTo: "2026-10-05" }]);
  });
});
