import {
  iccidSchema,
  imeiSchema,
  isImeiChecksumValid,
  periodOn,
  todayKyiv,
  type DeviceCard,
  type EquipmentCheck,
  type Installation,
  type SimCard,
} from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate, toDbDate } from "../../core/db/dates.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { DEVICE_LIST_ROW, HISTORY_MAX, SIM_LIST_ROW, toDeviceRow, toSimRow } from "./equipment.queries.js";

const HISTORY_ORDER = [
  { validFrom: "desc" },
  { id: "desc" },
] satisfies Prisma.DeviceInstallationOrderByWithRelationInput[];

async function readDeviceHistory(db: DbOrTx, deviceId: string): Promise<Installation[]> {
  const rows = await db.deviceInstallation.findMany({
    where: { deviceId },
    orderBy: HISTORY_ORDER,
    take: HISTORY_MAX,
    select: {
      id: true,
      validFrom: true,
      validTo: true,
      contractor: { select: { name: true } },
      object: { select: { id: true, name: true } },
    },
  });
  return rows.map(({ id, validFrom, validTo, contractor, object }) => ({
    id,
    validFrom: fromDbDate(validFrom),
    validTo: validTo && fromDbDate(validTo),
    contractorName: contractor?.name ?? null,
    label: object.name,
    objectId: object.id,
  }));
}

export async function getDeviceCard(db: DbOrTx, id: string): Promise<DeviceCard | null> {
  const row = await db.device.findUnique({ where: { id }, select: DEVICE_LIST_ROW });
  return row && { ...toDeviceRow(row), history: await readDeviceHistory(db, id) };
}

async function readSimHistory(db: DbOrTx, simId: string): Promise<Installation[]> {
  const rows = await db.simInstallation.findMany({
    where: { simId },
    orderBy: HISTORY_ORDER,
    take: HISTORY_MAX,
    select: {
      id: true,
      validFrom: true,
      validTo: true,
      contractor: { select: { name: true } },
      device: {
        select: {
          imei: true,
          installations: {
            select: { validFrom: true, validTo: true, object: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  return rows.map(({ id, validFrom, validTo, contractor, device }) => {
    const from = fromDbDate(validFrom);
    const periods = device.installations.map((period) => ({
      validFrom: fromDbDate(period.validFrom),
      validTo: period.validTo && fromDbDate(period.validTo),
      object: period.object,
    }));
    const stood = periodOn(periods, from);
    return {
      id,
      validFrom: from,
      validTo: validTo && fromDbDate(validTo),
      contractorName: contractor?.name ?? null,
      label: stood ? `${stood.object.name}, трекер ${device.imei}` : `Трекер ${device.imei}`,
      objectId: stood?.object.id ?? null,
    };
  });
}

async function readPlanCost(db: DbOrTx, planId: string): Promise<number | null> {
  const row = await db.costPrice.findFirst({
    where: { subjectType: "sim_plan", subjectId: planId, validFrom: { lte: toDbDate(todayKyiv()) } },
    orderBy: { validFrom: "desc" },
    select: { costKop: true },
  });
  return row && Number(row.costKop);
}

export async function getSimCard(db: DbOrTx, id: string, canReadCost: boolean): Promise<SimCard | null> {
  const row = await db.sim.findUnique({ where: { id }, select: SIM_LIST_ROW });
  if (!row) return null;
  const planCostKop = canReadCost && row.planId ? await readPlanCost(db, row.planId) : null;
  return { ...toSimRow(row), planCostKop, history: await readSimHistory(db, id) };
}

export async function checkImei(db: DbOrTx, value: string, excludeId: string | undefined): Promise<EquipmentCheck> {
  const parsed = imeiSchema.safeParse(value);
  if (!parsed.success) return { isValid: false, isFree: false, hasChecksumWarning: false, holder: null };
  const hasChecksumWarning = !isImeiChecksumValid(parsed.data);
  const holder = await db.device.findUnique({
    where: { imei: parsed.data },
    select: { id: true, archivedAt: true, object: { select: { id: true, name: true } } },
  });
  if (!holder || holder.id === excludeId) return { isValid: true, isFree: true, hasChecksumWarning, holder: null };
  const { id, archivedAt, object } = holder;
  return {
    isValid: true,
    isFree: false,
    hasChecksumWarning,
    holder: { id, isArchived: archivedAt !== null, objectId: object?.id ?? null, label: object?.name ?? "" },
  };
}

export async function checkIccid(db: DbOrTx, value: string, excludeId: string | undefined): Promise<EquipmentCheck> {
  const parsed = iccidSchema.safeParse(value);
  if (!parsed.success) return { isValid: false, isFree: false, hasChecksumWarning: false, holder: null };
  const holder = await db.sim.findUnique({
    where: { iccid: parsed.data },
    select: { id: true, archivedAt: true, device: { select: { imei: true, object: { select: { id: true } } } } },
  });
  if (!holder || holder.id === excludeId)
    return { isValid: true, isFree: true, hasChecksumWarning: false, holder: null };
  const { id, archivedAt, device } = holder;
  return {
    isValid: true,
    isFree: false,
    hasChecksumWarning: false,
    holder: {
      id,
      isArchived: archivedAt !== null,
      objectId: device?.object?.id ?? null,
      label: device ? `Трекер ${device.imei}` : "",
    },
  };
}
