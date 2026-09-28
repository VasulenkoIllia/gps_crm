// Reference dictionaries. Tariffs and add-ons follow the requirements spreadsheet (tariffs sheet).
// Costs, servers and models are demo assumptions.
import type {
  Addon, DisconnectReason, MonitoringServer, Program, SimPlan, Tariff, TrackerModel, User,
} from "../domain/types";

export const PROGRAMS: Program[] = [
  { id: "unitrack", name: "Unitrack", placementCost: 45 },
  { id: "forguard", name: "Forguard", placementCost: 60 },
  { id: "ruhavik", name: "Ruhavik", placementCost: 30 },
];

/** Fixed categorical colors per program (dataviz slots 1–3, never re-assigned). */
export const PROGRAM_COLORS: Record<string, string> = {
  unitrack: "#2a78d6",
  forguard: "#eb6834",
  ruhavik: "#1baf7a",
};

export const SERVERS: MonitoringServer[] = [
  { id: "ut-1", programId: "unitrack", name: "Unitrack · Сервер 1" },
  { id: "ut-2", programId: "unitrack", name: "Unitrack · Сервер 2", placementCost: 50 },
  { id: "fg-1", programId: "forguard", name: "Forguard · Основний" },
  { id: "rh-1", programId: "ruhavik", name: "Ruhavik · Cloud" },
];

export const TARIFFS: Tariff[] = [
  { id: "ut-start-m", programId: "unitrack", name: "Start", period: "month", price: 160 },
  { id: "ut-start-y", programId: "unitrack", name: "Start", period: "year", price: 1728 },
  { id: "ut-pro-m", programId: "unitrack", name: "Pro", period: "month", price: 220 },
  { id: "ut-pro-y", programId: "unitrack", name: "Pro", period: "year", price: 2376 },
  { id: "fg-base-m", programId: "forguard", name: "Базовий", period: "month", price: 250 },
  { id: "fg-base-y", programId: "forguard", name: "Базовий", period: "year", price: 2280 },
  { id: "fg-prem-m", programId: "forguard", name: "Преміум", period: "month", price: 390 },
  { id: "fg-prem-y", programId: "forguard", name: "Преміум", period: "year", price: 3480 },
  { id: "rh-sim-y", programId: "ruhavik", name: "SIM 12 міс", period: "year", price: 960 },
];

export const ADDONS: Addon[] = [
  { id: "roaming", name: "Роумінг", price: 150, programIds: ["unitrack"] },
  { id: "sent", name: "SENT / e-TOLL", price: 330, programIds: ["unitrack"] },
  { id: "agro", name: "Агроконтроль", price: 150, programIds: ["unitrack"] },
];

export const TRACKER_MODELS: TrackerModel[] = [
  { id: "fmb920", vendor: "Teltonika", name: "FMB920" },
  { id: "fmb125", vendor: "Teltonika", name: "FMB125" },
  { id: "fmc130", vendor: "Teltonika", name: "FMC130" },
  { id: "fmb140", vendor: "Teltonika", name: "FMB140" },
  { id: "eco4", vendor: "Ruptela", name: "FM-Eco4 light+" },
  { id: "gv300", vendor: "Queclink", name: "GV300" },
];

export const SIM_PLANS: SimPlan[] = [
  { id: "vf-m2m", operator: "Vodafone", name: "M2M Базовий", monthlyCost: 40 },
  { id: "vf-roam", operator: "Vodafone", name: "M2M Роумінг", monthlyCost: 140 },
  { id: "ks-m2m", operator: "Київстар", name: "M2M", monthlyCost: 45 },
];

export const DISCONNECT_REASONS: DisconnectReason[] = [
  { id: "sold", name: "Продаж транспорту" },
  { id: "competitor", name: "Перехід до іншого постачальника" },
  { id: "closed", name: "Припинення діяльності" },
  { id: "nonpay", name: "Несплата" },
  { id: "season", name: "Сезонне зняття з обслуговування" },
  { id: "other", name: "Інше" },
];

export const USERS: User[] = [
  { id: "u-admin", name: "Олена Коваль", role: "admin" },
  { id: "u-m1", name: "Андрій Мельник", role: "manager" },
  { id: "u-m2", name: "Ірина Бондар", role: "manager" },
  { id: "u-tech", name: "Сергій Ткач", role: "tech" },
];

export const byId = <T extends { id: string }>(list: T[]) =>
  Object.fromEntries(list.map((x) => [x.id, x])) as Record<string, T>;

export const PROGRAM_BY_ID = byId(PROGRAMS);
export const SERVER_BY_ID = byId(SERVERS);
export const TARIFF_BY_ID = byId(TARIFFS);
export const ADDON_BY_ID = byId(ADDONS);
export const MODEL_BY_ID = byId(TRACKER_MODELS);
export const SIM_PLAN_BY_ID = byId(SIM_PLANS);
export const REASON_BY_ID = byId(DISCONNECT_REASONS);
export const USER_BY_ID = byId(USERS);

export const modelLabel = (id?: string) => {
  const m = id ? MODEL_BY_ID[id] : undefined;
  return m ? `${m.vendor} ${m.name}` : "Не вказано";
};

export const tariffLabel = (id: string) => {
  const t = TARIFF_BY_ID[id];
  if (!t) return "—";
  return `${PROGRAM_BY_ID[t.programId]?.name ?? ""} ${t.name} · ${t.period === "month" ? "міс" : "рік"}`;
};
