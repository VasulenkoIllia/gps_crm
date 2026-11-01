import { afterEach, describe, expect, it, vi } from "vitest";
import { isDueAt, scheduleNightly } from "./nightly.js";

const TEN_MINUTES_MS = 10 * 60 * 1_000;

describe("isDueAt", () => {
  // 02:10 in Kyiv in winter (UTC+2) and in summer (UTC+3)
  it.each(["2027-01-15T00:10:00Z", "2027-07-15T23:10:00Z"])("is due at %s", (moment) => {
    expect(isDueAt(new Date(moment), 2, null)).toBe(true);
  });

  it("is not due outside the hour", () => {
    expect(isDueAt(new Date("2027-01-15T10:10:00Z"), 2, null)).toBe(false);
  });

  it("runs once a night", () => {
    expect(isDueAt(new Date("2027-01-15T00:10:00Z"), 2, "2027-01-15")).toBe(false);
  });
});

describe("scheduleNightly", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once in the hour", async () => {
    vi.useFakeTimers({ now: new Date("2027-01-15T00:05:00Z") });
    const run = vi.fn(() => Promise.resolve());

    const stop = scheduleNightly(2, run, () => undefined);
    await vi.advanceTimersByTimeAsync(5 * TEN_MINUTES_MS);
    stop();

    expect(run).toHaveBeenCalledOnce();
  });

  it("runs again the next night", async () => {
    vi.useFakeTimers({ now: new Date("2027-01-15T00:05:00Z") });
    const run = vi.fn(() => Promise.resolve());

    const stop = scheduleNightly(2, run, () => undefined);
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1_000);
    stop();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("tries again within the hour after a failure, then stops for the night", async () => {
    vi.useFakeTimers({ now: new Date("2027-01-15T00:05:00Z") });
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("database is away"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();

    const stop = scheduleNightly(2, run, onError);
    await vi.advanceTimersByTimeAsync(5 * TEN_MINUTES_MS);
    stop();

    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("does nothing once stopped", async () => {
    vi.useFakeTimers({ now: new Date("2027-01-15T00:05:00Z") });
    const run = vi.fn(() => Promise.resolve());

    scheduleNightly(2, run, () => undefined)();
    await vi.advanceTimersByTimeAsync(5 * TEN_MINUTES_MS);

    expect(run).not.toHaveBeenCalled();
  });
});
