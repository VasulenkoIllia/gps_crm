import { firstOfNextMonth, todayKyiv, type Tariff } from "@gps_crm/shared";
import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { isTariffDateRefused, tariffLabel, tariffOptionsOf } from "./subscriber-form";

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
