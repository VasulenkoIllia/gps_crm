import { describe, expect, it } from "vitest";
import { digitGroups, formatBytes } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 Б"],
    [512, "512 Б"],
    [1024, "1 КБ"],
    [1536, "1,5 КБ"],
    [5 * 1024 ** 3, "5 ГБ"],
    [3 * 1024 ** 4, "3 ТБ"],
    [2048 * 1024 ** 4, "2 048 ТБ"],
  ])("shows %d as %s", (bytes, text) => {
    expect(formatBytes(bytes).replace(/\s/g, " ")).toBe(text);
  });
});

describe("digitGroups", () => {
  it("splits a number into fours from its start", () => {
    expect(digitGroups("356938035643809")).toEqual(["3569", "3803", "5643", "809"]);
    expect(digitGroups("")).toEqual([]);
  });
});
