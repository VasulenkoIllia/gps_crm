import { describe, expect, it } from "vitest";
import { isLivePeriod, periodOn, planVersion } from "./periods.ts";

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
