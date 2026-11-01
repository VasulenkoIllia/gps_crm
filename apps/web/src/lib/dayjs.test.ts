import { describe, expect, it } from "vitest";
import { formatDateTime, isDateValue, startOfDay, startOfNextDay } from "./dayjs";

describe("formatDateTime", () => {
  it("shows Kyiv time in winter and in summer, whatever the device's zone", () => {
    expect(formatDateTime("2027-01-15T10:30:00.000Z")).toBe("15.01.2027 12:30");
    expect(formatDateTime("2027-07-15T10:30:00.000Z")).toBe("15.07.2027 13:30");
  });

  it("crosses midnight", () => {
    expect(formatDateTime("2027-01-15T23:30:00.000Z")).toBe("16.01.2027 01:30");
  });
});

describe("the days of a period", () => {
  it("start at Kyiv midnight, in winter and in summer", () => {
    expect(startOfDay("2027-01-15")).toBe("2027-01-14T22:00:00.000Z");
    expect(startOfDay("2027-07-15")).toBe("2027-07-14T21:00:00.000Z");
  });

  it("end at the next midnight over both clock changes", () => {
    expect(startOfNextDay("2027-03-28")).toBe("2027-03-28T21:00:00.000Z");
    expect(startOfNextDay("2027-10-31")).toBe("2027-10-31T22:00:00.000Z");
  });
});

describe("isDateValue", () => {
  it("takes a real date only", () => {
    expect(isDateValue("2027-02-28")).toBe(true);
    expect(isDateValue("2027-02-30")).toBe(false);
    expect(isDateValue("2027-13-01")).toBe(false);
    expect(isDateValue("вчора")).toBe(false);
  });
});
