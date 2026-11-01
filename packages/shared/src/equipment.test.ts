import { describe, expect, it } from "vitest";
import { addDays, todayKyiv } from "./dates.ts";
import {
  deviceChoiceSchema,
  iccidSchema,
  imeiSchema,
  isImeiChecksumValid,
  normalizeNumber,
  pastDateSchema,
  simChoiceSchema,
  simCreateSchema,
} from "./equipment.ts";

const SOME_ID = "0190b5a0-0000-7000-8000-000000000001";

describe("normalizeNumber", () => {
  it("drops what a sticker has between the digits", () => {
    expect(normalizeNumber("35 6938-0355 12345")).toBe("356938035512345");
  });
});

describe("isImeiChecksumValid", () => {
  it("passes a number with a right check digit", () => {
    expect(isImeiChecksumValid("490154203237518")).toBe(true);
  });

  it("notices a wrong one", () => {
    expect(isImeiChecksumValid("490154203237519")).toBe(false);
  });
});

describe("number schemas", () => {
  it("takes an IMEI of 15 digits, however it was typed", () => {
    expect(imeiSchema.parse("4901 5420-3237 518")).toBe("490154203237518");
    expect(imeiSchema.safeParse("49015420323751").success).toBe(false);
    expect(imeiSchema.safeParse("49015420323751x").success).toBe(false);
  });

  it("takes an ICCID of 19 or 20 digits", () => {
    expect(iccidSchema.safeParse("8938012345678901234").success).toBe(true);
    expect(iccidSchema.safeParse("89380123456789012345").success).toBe(true);
    expect(iccidSchema.safeParse("893801234567890123").success).toBe(false);
  });
});

describe("pastDateSchema", () => {
  it("stops at today", () => {
    expect(pastDateSchema.safeParse(todayKyiv()).success).toBe(true);
    expect(pastDateSchema.safeParse(addDays(todayKyiv(), 1)).success).toBe(false);
  });
});

describe("choice of equipment in a form", () => {
  it("takes one from the list or a new one", () => {
    expect(deviceChoiceSchema.safeParse({ deviceId: SOME_ID }).success).toBe(true);
    expect(deviceChoiceSchema.safeParse({ imei: "490154203237518" }).success).toBe(true);
  });

  it("refuses both and neither", () => {
    expect(deviceChoiceSchema.safeParse({}).success).toBe(false);
    expect(deviceChoiceSchema.safeParse({ deviceId: SOME_ID, imei: "490154203237518" }).success).toBe(false);
  });

  it("wants the operator of a plan", () => {
    const plan = { iccid: "8938012345678901234", planId: SOME_ID };
    expect(simChoiceSchema.safeParse(plan).success).toBe(false);
    expect(simCreateSchema.safeParse(plan).success).toBe(false);
    expect(simChoiceSchema.safeParse({ ...plan, operatorId: SOME_ID }).success).toBe(true);
  });
});
