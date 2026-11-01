import { describe, expect, it } from "vitest";
import { businessDateSchema, firstOfNextMonth, todayKyiv } from "./dates.ts";

describe("business dates", () => {
  it("takes the day from Kyiv and not from UTC", () => {
    expect(todayKyiv(new Date("2026-12-31T21:59:59Z"))).toBe("2026-12-31");
    expect(todayKyiv(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });

  it("follows the clock change", () => {
    expect(todayKyiv(new Date("2026-07-15T21:00:00Z"))).toBe("2026-07-16");
    expect(todayKyiv(new Date("2026-07-15T20:59:59Z"))).toBe("2026-07-15");
  });

  it("finds the first of the next month over the end of a year", () => {
    expect(firstOfNextMonth("2026-11-15")).toBe("2026-12-01");
    expect(firstOfNextMonth("2026-12-31")).toBe("2027-01-01");
  });

  it.each(["2026-02-30", "0000-01-01", "20270-01-01", "2100-01-01", "1999-12-31", "01.01.2027", ""])(
    "refuses %s as a date",
    (date) => {
      expect(businessDateSchema.safeParse(date).success).toBe(false);
    },
  );

  it("takes a real date", () => {
    expect(businessDateSchema.safeParse("2028-02-29").success).toBe(true);
  });
});
