import { firstOfNextMonth, todayKyiv, type Tariff } from "@gps_crm/shared";
import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { isTariffDateRefused, tariffLabel, tariffOptionsOf, tariffVersionsOf } from "./subscriber-form";

const tariff = (id: string, programId: string): Tariff => ({
  id,
  version: 1,
  programId,
  programName: "Програма",
  serverId: "server",
  serverName: "Сервер 1",
  name: "Тариф",
  billingModel: "month",
  priceKop: 15_000,
  isActive: true,
  isSelected: false,
  clientCount: 0,
  basedOnName: null,
  newerVersionName: null,
});

describe("tariffLabel", () => {
  it("tells two tariffs of one name apart by the server, the period and the price", () => {
    const label = tariffLabel(tariff("a", "p"));
    expect(label).toContain("Тариф, Сервер 1");
    expect(label).toContain("150,00 грн");
  });
});

describe("tariffOptionsOf", () => {
  const tariffs = [tariff("a", "first"), tariff("b", "second")];

  it("offers only the tariffs of the chosen program", () => {
    expect(tariffOptionsOf(tariffs, "second").map(({ value }) => value)).toEqual(["b"]);
  });

  it("offers nothing before a program is chosen", () => {
    expect(tariffOptionsOf(tariffs, undefined)).toEqual([]);
    expect(tariffOptionsOf(undefined, "first")).toEqual([]);
  });
});

describe("isTariffDateRefused", () => {
  it("takes the first of next month and refuses the day after it", () => {
    const allowed = firstOfNextMonth(todayKyiv());
    expect(isTariffDateRefused(dayjs(allowed))).toBe(false);
    expect(isTariffDateRefused(dayjs(allowed).add(1, "day"))).toBe(true);
  });
});

// П3 of the manual test of 05.11.2026: «Змінити тариф» showed the planned version as «Зараз»
describe("tariffVersionsOf", () => {
  const version = (id: string, validFrom: string, validTo: string | null = null) => ({
    id,
    tariffId: id,
    tariffName: id,
    programName: "Програма",
    serverName: "Сервер 1",
    billingModel: "month" as const,
    priceKop: 10_000,
    validFrom,
    validTo,
  });
  const history = [
    version("planned", "2026-12-01"),
    version("replaced", "2026-11-20", "2026-11-20"),
    version("now", "2026-10-01", "2026-12-01"),
    version("before", "2026-01-01", "2026-10-01"),
  ];

  it("keeps the version in force apart from the planned one", () => {
    const { current, next, earlier } = tariffVersionsOf(history, "2026-11-05");
    expect(current?.id).toBe("now");
    expect(next?.id).toBe("planned");
    expect(earlier.map(({ id }) => id)).toEqual(["replaced", "before"]);
  });

  it("has nothing in force before the first version begins", () => {
    const { current, next } = tariffVersionsOf([version("first", "2026-12-01")], "2026-11-05");
    expect(current).toBeNull();
    expect(next?.id).toBe("first");
  });
});
