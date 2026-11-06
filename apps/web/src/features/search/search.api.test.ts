import type { SearchResult } from "@gps_crm/shared";
import { describe, expect, it } from "vitest";
import { sectionsOf } from "./search.api";

const NOTHING = { items: [], hasMore: false };

const result: SearchResult = {
  clients: {
    items: [{ id: "c1", code: 10001, legacyCode: "А-1", name: "Ромашка", taxId: null, isArchived: false }],
    hasMore: true,
  },
  contacts: {
    items: [
      {
        id: "p1",
        fullName: "Петро",
        phone: "+380501112233",
        subscriberId: "c1",
        subscriberCode: 10001,
        subscriberName: "Ромашка",
        isArchived: false,
      },
    ],
    hasMore: false,
  },
  objects: NOTHING,
  devices: {
    items: [
      { id: "d1", imei: "356938035643809", modelName: null, objectId: "o1", objectName: "Тягач", isArchived: false },
      { id: "d2", imei: "356938035643810", modelName: "FMB", objectId: null, objectName: null, isArchived: true },
    ],
    hasMore: false,
  },
  sims: null,
};

describe("the sections of the search", () => {
  const sections = sectionsOf(result, "ромашка");

  it("keeps the order of the screen and leaves out the kinds that were not searched", () => {
    expect(sections.map((section) => section.key)).toEqual(["clients", "contacts", "objects", "devices"]);
  });

  it("leads each line to its card, and a tracker to its object or to the stock found by its number", () => {
    expect(sections[0]?.lines[0]).toMatchObject({
      to: "/subscribers/c1",
      title: "Ромашка, ID 10001",
      meta: "старий номер А-1",
    });
    expect(sections[1]?.lines[0]).toMatchObject({
      to: "/subscribers/c1?tab=contacts",
      meta: "+380 50 111 22 33 · Ромашка, ID 10001",
    });
    expect(sections[3]?.lines.map((line) => line.to)).toEqual([
      "/objects/o1",
      "/equipment?tab=devices&q=356938035643810",
    ]);
  });

  it("offers the whole list only where there is more and a list to show it", () => {
    expect(sections.map((section) => section.moreTo)).toEqual([
      "/subscribers?q=%D1%80%D0%BE%D0%BC%D0%B0%D1%88%D0%BA%D0%B0",
      null,
      null,
      null,
    ]);
  });
});
