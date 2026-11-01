import { describe, expect, it } from "vitest";
import { formatDateTime } from "./dayjs";

describe("formatDateTime", () => {
  it("shows Kyiv time in winter and in summer, whatever the device's zone", () => {
    expect(formatDateTime("2027-01-15T10:30:00.000Z")).toBe("15.01.2027 12:30");
    expect(formatDateTime("2027-07-15T10:30:00.000Z")).toBe("15.07.2027 13:30");
  });

  it("crosses midnight", () => {
    expect(formatDateTime("2027-01-15T23:30:00.000Z")).toBe("16.01.2027 01:30");
  });
});
