import { describe, expect, it } from "vitest";
import { accountKey, delayAfter, pairKey, secondFactorKey } from "./throttle.js";

describe("pairKey", () => {
  it("does not let a change of address inside one IPv6 network start a new count", () => {
    const key = (ip: string) => pairKey("a@example.test", ip);
    expect(key("2001:db8:1:2::1")).toBe(key("2001:db8:1:2::2"));
  });
});

describe("delayAfter", () => {
  it.each([
    [0, 0],
    [4, 0],
    [5, 2],
    [6, 4],
    [9, 32],
    [10, 60],
    [1000, 60],
  ])("after %i failures waits %i seconds", (failures, seconds) => {
    expect(delayAfter(failures)).toBe(seconds);
  });
});

describe("keys", () => {
  it("keep the three counters apart", () => {
    expect(new Set([accountKey("a@b.co"), pairKey("a@b.co", "1.1.1.1"), secondFactorKey("a@b.co")]).size).toBe(3);
  });
});
