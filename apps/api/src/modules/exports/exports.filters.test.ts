import { describe, expect, it } from "vitest";
import { describeFilters, referencedIds } from "./exports.filters.js";

const PROGRAM_ID = "019a0000-0000-7000-8000-000000000001";
const GONE_ID = "019a0000-0000-7000-8000-000000000002";

describe("the filters of an export in the journal", () => {
  it("says them in the words of the screen, with the names of the records", () => {
    const request = {
      entity: "objects",
      filters: { q: "тягач", status: "suspended", programId: PROGRAM_ID, managerId: GONE_ID, archived: "true" },
      sort: "createdAt",
      order: "desc",
    } as const;

    expect(referencedIds(request)).toEqual([
      ["programId", PROGRAM_ID],
      ["managerId", GONE_ID],
    ]);
    expect(describeFilters(request, new Map([[PROGRAM_ID, "Програма 1"]]))).toBe(
      `Пошук: «тягач»; Статус: Призупинений; Програма: Програма 1; Менеджер: ${GONE_ID}; Архів: в архіві`,
    );
  });

  it("says the dates and the term of the contracts as the screen does", () => {
    const request = {
      entity: "contracts",
      filters: { status: "active", expiring: "true", signedFrom: "2026-01-01", signedTo: "2026-06-30" },
    } as const;

    expect(describeFilters(request, new Map())).toBe(
      "Статус: Діючий; Спливають: за 30 днів; Підписано від: 01.01.2026; Підписано до: 30.06.2026",
    );
  });

  it("has nothing to say about a whole list", () => {
    expect(describeFilters({ entity: "sensors", filters: {} }, new Map())).toBeNull();
  });
});
