import { describe, expect, it } from "vitest";
import { ACTIVITY_ENTITY_TYPES } from "./activity.ts";
import {
  addonCreateSchema,
  currentPrice,
  nextPrice,
  REFERENCE_ENTITY_TYPES,
  REFERENCE_KINDS,
  serverCreateSchema,
  simpleReferenceInputSchema,
  SIMPLE_REFERENCE_KINDS,
  tariffCreateSchema,
} from "./references.ts";

const PROGRAM_ID = "019a0000-0000-7000-8000-000000000001";
const SERVER_ID = "019a0000-0000-7000-8000-000000000002";

const HISTORY = [
  { id: "1", amountKop: 15_000, validFrom: "2026-01-01" },
  { id: "2", amountKop: 10_000, validFrom: "2026-11-01" },
  { id: "3", amountKop: 20_000, validFrom: "2027-01-01" },
];

describe("reference contracts", () => {
  it("names every kind in the journal", () => {
    for (const kind of REFERENCE_KINDS) {
      expect(ACTIVITY_ENTITY_TYPES[REFERENCE_ENTITY_TYPES[kind]]).toBeTruthy();
    }
  });

  it("keeps the simple kinds among all kinds", () => {
    expect(REFERENCE_KINDS).toEqual(expect.arrayContaining([...SIMPLE_REFERENCE_KINDS]));
  });

  it("turns an empty note into no note, and a place in the list defaults to the start", () => {
    expect(simpleReferenceInputSchema.parse({ name: " Назва ", note: "  " })).toEqual({
      name: "Назва",
      note: null,
      sortOrder: 0,
    });
  });

  it("refuses a name of spaces and an unknown key", () => {
    expect(simpleReferenceInputSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(simpleReferenceInputSchema.safeParse({ name: "Назва", extra: 1 }).success).toBe(false);
  });

  it("takes a server address only over http or https, and none at all", () => {
    const server = { programId: PROGRAM_ID, name: "Сервер 1" };
    expect(serverCreateSchema.parse({ ...server, url: "" }).url).toBeNull();
    expect(serverCreateSchema.safeParse({ ...server, url: "https://server.example" }).success).toBe(true);
    expect(serverCreateSchema.safeParse({ ...server, url: "ftp://server.example" }).success).toBe(false);
    expect(serverCreateSchema.safeParse({ ...server, url: "javascript:alert(1)" }).success).toBe(false);
  });

  it("wants a price above zero, in whole kopecks", () => {
    const tariff = { programId: PROGRAM_ID, serverId: SERVER_ID, name: "Тариф 1", billingModel: "month" };
    expect(tariffCreateSchema.safeParse({ ...tariff, priceKop: 1 }).success).toBe(true);
    expect(tariffCreateSchema.safeParse({ ...tariff, priceKop: 0 }).error?.issues[0]?.message).toBe(
      "Вкажіть ціну більше нуля",
    );
    expect(tariffCreateSchema.safeParse({ ...tariff, priceKop: 10.5 }).success).toBe(false);
  });

  it("wants at least one program for an addon", () => {
    const addon = { name: "Послуга 1", price: { amountKop: 15_000, validFrom: "2026-11-01" } };
    expect(addonCreateSchema.safeParse({ ...addon, programIds: [] }).success).toBe(false);
    expect(addonCreateSchema.safeParse({ ...addon, programIds: [PROGRAM_ID] }).success).toBe(true);
  });
});

describe("the price in force", () => {
  it("is the last one that has started", () => {
    expect(currentPrice(HISTORY, "2026-10-31")?.amountKop).toBe(15_000);
    expect(currentPrice(HISTORY, "2026-11-01")?.amountKop).toBe(10_000);
    expect(currentPrice(HISTORY, "2027-01-01")?.amountKop).toBe(20_000);
  });

  it("does not exist before the first date, and a future price does not count yet", () => {
    expect(currentPrice(HISTORY, "2025-12-31")).toBeNull();
    expect(currentPrice([], "2026-11-01")).toBeNull();
  });

  it("gives way to the next planned one", () => {
    expect(nextPrice(HISTORY, "2026-11-15")?.amountKop).toBe(20_000);
    expect(nextPrice(HISTORY, "2027-01-01")).toBeNull();
  });
});
