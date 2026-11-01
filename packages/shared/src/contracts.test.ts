import { describe, expect, it } from "vitest";
import { contractCreateSchema, contractStatus, isContractExpiring } from "./contracts.ts";

const TODAY = "2026-11-10";
const ID = "019a0000-0000-7000-8000-000000000001";

const dates = (signedOn: string, validUntil: string, terminatedOn: string | null = null) => ({
  signedOn,
  validUntil,
  terminatedOn,
});

describe("status of a contract", () => {
  it.each([
    ["signed ahead", dates("2026-12-01", "2027-12-01"), "pending"],
    ["in force", dates("2026-01-01", "2027-01-01"), "active"],
    ["ending today", dates("2026-01-01", TODAY), "active"],
    ["ended yesterday", dates("2026-01-01", "2026-11-09"), "expired"],
    ["terminated", dates("2026-01-01", "2027-01-01", "2026-06-01"), "terminated"],
  ])("%s", (_name, contract, status) => {
    expect(contractStatus(contract, TODAY)).toBe(status);
  });
});

describe("a contract running out", () => {
  it("counts less than 30 days to the end", () => {
    expect(isContractExpiring(dates("2026-01-01", "2026-12-09"), TODAY)).toBe(true);
    expect(isContractExpiring(dates("2026-01-01", "2026-12-10"), TODAY)).toBe(false);
  });

  it("is about a contract in force only", () => {
    expect(isContractExpiring(dates("2026-01-01", "2026-11-09"), TODAY)).toBe(false);
    expect(isContractExpiring(dates("2026-01-01", "2026-12-01", "2026-06-01"), TODAY)).toBe(false);
  });
});

describe("the form of a contract", () => {
  const form = (fields: object) => ({
    payerId: ID,
    number: "12/26",
    signedOn: "2026-01-01",
    validUntil: "2026-12-31",
    ...fields,
  });
  const problemOf = (fields: object) => contractCreateSchema.safeParse(form(fields)).error?.issues[0]?.message;

  it("wants the end not before the signing", () => {
    expect(problemOf({ validUntil: "2025-12-31" })).toBe("Дата закінчення раніше дати підписання");
  });

  it("wants the end at all", () => {
    expect(problemOf({ validUntil: undefined })).toBe("Вкажіть, до якої дати діє договір");
  });

  it("wants termination not before the signing", () => {
    expect(problemOf({ terminatedOn: "2025-12-31" })).toBe("Дата розірвання раніше дати підписання");
  });
});
