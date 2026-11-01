import { describe, expect, it } from "vitest";
import { chooseableOptions } from "./dict-options";

const OPTIONS = [
  { value: "on", label: "Активний", isActive: true },
  { value: "off", label: "Деактивований", isActive: false },
  { value: "gone", label: "Інший деактивований", isActive: false },
];
const labels = (value?: string | string[]) => chooseableOptions(OPTIONS, value).map(({ label }) => label);

describe("chooseableOptions", () => {
  it("offers only active records to a new choice", () => {
    expect(labels()).toEqual(["Активний"]);
  });

  it("keeps a deactivated record where it is already chosen", () => {
    expect(labels("off")).toEqual(["Активний", "Деактивований"]);
    expect(labels(["off", "gone"])).toEqual(["Активний", "Деактивований", "Інший деактивований"]);
  });

  it("gives the select nothing but its value and label", () => {
    expect(chooseableOptions(OPTIONS, undefined)).toEqual([{ value: "on", label: "Активний" }]);
  });
});
