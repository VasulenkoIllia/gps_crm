import { describe, expect, it } from "vitest";
import { normalizeName } from "./normalize.ts";

describe("normalizeName", () => {
  it("ignores case, spacing and the kind of apostrophe", () => {
    expect(normalizeName("  Об’єкт   Alpha ")).toBe("об'єкт alpha");
    expect(normalizeName("Об'єкт Alpha")).toBe(normalizeName("ОБʼЄКТ alpha"));
  });

  it("takes both spellings of one letter as one name", () => {
    expect(normalizeName("Київський".normalize("NFD"))).toBe(normalizeName("Київський"));
  });
});
