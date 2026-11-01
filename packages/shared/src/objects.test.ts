import { describe, expect, it } from "vitest";
import { addDays, firstOfNextMonth, todayKyiv } from "./dates.ts";
import {
  objectListQuerySchema,
  nextObjectStatuses,
  objectCreateSchema,
  objectStatusChangeSchema,
  objectTariffOn,
  objectTermsChangeSchema,
  replaceDeviceSchema,
} from "./objects.ts";

const SOME_ID = "0190b5a0-0000-7000-8000-000000000001";
const TODAY = todayKyiv();

const form = {
  subscriberId: SOME_ID,
  name: "Об'єкт",
  status: "active",
  statusFrom: TODAY,
  connectedOn: TODAY,
  device: { imei: "490154203237518" },
  installedOn: TODAY,
  sim: { iccid: "8938012345678901234" },
  payerId: SOME_ID,
};

describe("objectCreateSchema", () => {
  it("takes the fields the client marked as required", () => {
    expect(objectCreateSchema.safeParse(form).success).toBe(true);
  });

  it("wants the date a tracker went on", () => {
    const { success, error } = objectCreateSchema.safeParse({ ...form, installedOn: "" });
    expect(success).toBe(false);
    expect(error?.issues[0]?.path).toEqual(["installedOn"]);
  });

  it("wants a reason only for a disconnected object", () => {
    expect(objectCreateSchema.safeParse({ ...form, status: "disconnected" }).success).toBe(false);
    const reason = { disconnectReasonId: SOME_ID };
    expect(objectCreateSchema.safeParse({ ...form, status: "disconnected", ...reason }).success).toBe(true);
    expect(objectCreateSchema.safeParse({ ...form, ...reason }).success).toBe(false);
  });

  it("refuses a status or a tracker before the object was connected", () => {
    const earlier = addDays(TODAY, -1);
    expect(objectCreateSchema.safeParse({ ...form, statusFrom: earlier }).success).toBe(false);
    expect(objectCreateSchema.safeParse({ ...form, installedOn: earlier }).success).toBe(false);
  });

  it("refuses a date ahead for a status, and allows the next month for an own tariff", () => {
    const next = firstOfNextMonth(TODAY);
    expect(objectCreateSchema.safeParse({ ...form, statusFrom: next }).success).toBe(false);
    const ownTariff = { programId: SOME_ID, tariffId: SOME_ID, validFrom: next };
    expect(objectCreateSchema.safeParse({ ...form, ownTariff }).success).toBe(true);
  });
});

describe("objectStatusChangeSchema", () => {
  it("wants a reason for a disconnection", () => {
    const change = { status: "disconnected", validFrom: TODAY };
    expect(objectStatusChangeSchema.safeParse(change).success).toBe(false);
    expect(objectStatusChangeSchema.safeParse({ ...change, reasonId: SOME_ID }).success).toBe(true);
  });
});

describe("objectListQuerySchema", () => {
  it("refuses a cursor its sort column cannot hold", () => {
    const cursor = `не-ідентифікатор_${SOME_ID}`;
    expect(objectListQuerySchema.safeParse({ sort: "subscriber", cursor }).success).toBe(false);
    expect(objectListQuerySchema.safeParse({ sort: "connectedOn", cursor }).success).toBe(false);
    expect(objectListQuerySchema.safeParse({ sort: "name", cursor }).success).toBe(true);
    expect(objectListQuerySchema.safeParse({ sort: "subscriber", cursor: `${SOME_ID}_${SOME_ID}` }).success).toBe(true);
  });
});

describe("objectTermsChangeSchema", () => {
  it("wants something to change", () => {
    expect(objectTermsChangeSchema.safeParse({ validFrom: TODAY }).success).toBe(false);
  });

  it("gives a payer no date ahead, and a tariff the first of the next month", () => {
    const validFrom = firstOfNextMonth(TODAY);
    expect(objectTermsChangeSchema.safeParse({ validFrom, payerId: SOME_ID }).success).toBe(false);
    expect(objectTermsChangeSchema.safeParse({ validFrom, ownTariff: null }).success).toBe(true);
  });

  it("gives a payer no date ahead through a change of the tariff either", () => {
    const validFrom = firstOfNextMonth(TODAY);
    expect(objectTermsChangeSchema.safeParse({ validFrom, payerId: SOME_ID, ownTariff: null }).success).toBe(false);
  });
});

describe("replaceDeviceSchema", () => {
  const change = { device: { deviceId: SOME_ID }, installedOn: TODAY };

  it("wants the SIM either moved or chosen", () => {
    expect(replaceDeviceSchema.safeParse({ ...change, moveSim: true }).success).toBe(true);
    expect(replaceDeviceSchema.safeParse({ ...change, moveSim: false }).success).toBe(false);
    const sim = { simId: SOME_ID };
    expect(replaceDeviceSchema.safeParse({ ...change, moveSim: false, sim }).success).toBe(true);
    expect(replaceDeviceSchema.safeParse({ ...change, moveSim: true, sim }).success).toBe(false);
  });
});

describe("nextObjectStatuses", () => {
  it("leaves a disconnected object one way", () => {
    expect(nextObjectStatuses("disconnected")).toEqual(["active"]);
    expect(nextObjectStatuses("active")).toEqual(["suspended", "disconnected"]);
  });
});

describe("objectTariffOn", () => {
  const client = [
    { tariffId: "new", validFrom: "2026-12-01", validTo: null },
    { tariffId: "old", validFrom: "2026-01-01", validTo: "2026-12-01" },
  ];
  const clientTerm = { ownTariffId: null, validFrom: "2026-02-01", validTo: null };

  it("follows the client on a version of its own date", () => {
    expect(objectTariffOn("2026-11-30", [clientTerm], client)).toEqual({ tariffId: "old", isOwn: false });
    expect(objectTariffOn("2026-12-01", [clientTerm], client)).toEqual({ tariffId: "new", isOwn: false });
  });

  it("holds an own tariff from its date and goes back after", () => {
    const terms = [
      { ownTariffId: null, validFrom: "2026-06-01", validTo: null },
      { ownTariffId: "own", validFrom: "2026-03-01", validTo: "2026-06-01" },
      { ownTariffId: null, validFrom: "2026-02-01", validTo: "2026-03-01" },
    ];
    expect(objectTariffOn("2026-02-28", terms, client)?.tariffId).toBe("old");
    expect(objectTariffOn("2026-03-01", terms, client)).toEqual({ tariffId: "own", isOwn: true });
    expect(objectTariffOn("2026-06-01", terms, client)?.isOwn).toBe(false);
  });

  it("falls to the first version before any of them begins", () => {
    const future = [{ tariffId: "first", validFrom: "2027-01-01", validTo: null }];
    expect(objectTariffOn("2026-11-01", [clientTerm], future)?.tariffId).toBe("first");
  });

  it("skips a version replaced before it began", () => {
    const replaced = [
      { ownTariffId: null, validFrom: "2026-02-01", validTo: null },
      { ownTariffId: "own", validFrom: "2026-02-01", validTo: "2026-02-01" },
    ];
    expect(objectTariffOn("2026-02-01", replaced, client)?.isOwn).toBe(false);
  });
});
