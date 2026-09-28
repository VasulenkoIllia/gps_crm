// Pure billing rules. Demo assumption, to be confirmed with the client: each object carries a "paid until" date,
// debt = full overdue months × monthly price. Replace once the client confirms the real model.
import dayjs from "dayjs";
import type { GpsObject, ObjectStatus, SubscriberStatus, Tariff } from "./types";
import { ADDON_BY_ID, PROGRAM_BY_ID, SERVER_BY_ID, SIM_PLAN_BY_ID, TARIFF_BY_ID } from "../data/reference";

/** Grace period after `paidUntil` before an object is expected to be suspended (assumption). */
export const GRACE_DAYS = 10;

export function tariffMonthly(t: Tariff | undefined): number {
  if (!t) return 0;
  return t.period === "month" ? t.price : t.price / 12;
}

export interface PriceBreakdown {
  tariff: number;
  addons: number;
  discount: number;
  total: number;
}

/** Expected revenue for one object, UAH / month (annual tariffs spread over 12 months). */
export function objectPrice(o: Pick<GpsObject, "tariffId" | "addonIds" | "discount">): PriceBreakdown {
  const tariff = tariffMonthly(TARIFF_BY_ID[o.tariffId]);
  const addons = o.addonIds.reduce((s, id) => s + (ADDON_BY_ID[id]?.price ?? 0), 0);
  const total = Math.max(0, tariff + addons - o.discount);
  return { tariff, addons, discount: o.discount, total };
}

export interface CostBreakdown {
  placement: number;
  sim: number;
  total: number;
}

/** Cost of keeping one object in service, UAH / month: platform placement + SIM plan. */
export function objectCost(o: Pick<GpsObject, "programId" | "serverId">, simPlanId?: string): CostBreakdown {
  const placement = SERVER_BY_ID[o.serverId]?.placementCost ?? PROGRAM_BY_ID[o.programId]?.placementCost ?? 0;
  const sim = simPlanId ? SIM_PLAN_BY_ID[simPlanId]?.monthlyCost ?? 0 : 0;
  return { placement, sim, total: placement + sim };
}

/** Number of started months since `paidUntil` (0 when paid up). */
export function overdueMonths(paidUntil: string, today: dayjs.Dayjs): number {
  const paid = dayjs(paidUntil);
  if (!paid.isBefore(today, "day")) return 0;
  const days = today.diff(paid, "day");
  return Math.max(1, Math.ceil(days / 30.4));
}

export function overdueDays(paidUntil: string, today: dayjs.Dayjs): number {
  const paid = dayjs(paidUntil);
  return paid.isBefore(today, "day") ? today.diff(paid, "day") : 0;
}

export function objectDebt(o: GpsObject, today: dayjs.Dayjs): number {
  if (o.status === "disconnected") return 0;
  return overdueMonths(o.paidUntil, today) * objectPrice(o).total;
}

/** Subscriber status derived from its objects (assumption: not set manually). */
export function deriveSubscriberStatus(statuses: ObjectStatus[]): SubscriberStatus {
  const live = statuses.filter((s) => s !== "disconnected");
  if (statuses.length === 0 || live.length === 0) return "disconnected";
  if (live.every((s) => s === "suspended")) return "suspended";
  if (live.some((s) => s === "suspended")) return "partial";
  return "active";
}

/** Extends `paidUntil` by whole periods; returns the new date. */
export function extendPaidUntil(paidUntil: string, months: number): string {
  return dayjs(paidUntil).add(1, "day").add(months, "month").subtract(1, "day").format("YYYY-MM-DD");
}
