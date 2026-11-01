import {
  normalizeName,
  reverseDigits,
  type AvailableQuery,
  type DeviceList,
  type DeviceListQuery,
  type DeviceRow,
  type EquipmentPlace,
  type SensorList,
  type SensorListQuery,
  type SensorRow,
  type SimList,
  type SimListQuery,
  type SimRow,
} from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate } from "../../core/db/dates.js";
import { escapeLike } from "../../core/db/like.js";
import type { Prisma } from "../../generated/prisma/client.js";
import type { EquipmentKind } from "./equipment.repository.js";

export const HISTORY_MAX = 100;
const MIN_NUMBER_SEARCH = 4;
const MIN_SERIAL_SEARCH = 3;
const NOTHING = { id: { in: [] } };

const PLACE_SELECT = {
  validFrom: true,
  contractor: { select: { name: true } },
  object: {
    select: { id: true, name: true, subscriber: { select: { id: true, code: true, name: true } } },
  },
} satisfies Prisma.DeviceInstallationSelect;

type PlaceRow = Prisma.DeviceInstallationGetPayload<{ select: typeof PLACE_SELECT }>;

function placeOf(row: PlaceRow | undefined): EquipmentPlace | null {
  if (!row) return null;
  const { object, contractor, validFrom } = row;
  return {
    objectId: object.id,
    objectName: object.name,
    subscriberId: object.subscriber.id,
    subscriberName: object.subscriber.name,
    subscriberCode: Number(object.subscriber.code),
    installedOn: fromDbDate(validFrom),
    contractorName: contractor?.name ?? null,
  };
}

const OPEN_INSTALLATION = { where: { validTo: null }, select: PLACE_SELECT };

export const DEVICE_LIST_ROW = {
  id: true,
  version: true,
  imei: true,
  modelId: true,
  ownership: true,
  status: true,
  note: true,
  archivedAt: true,
  model: { select: { name: true } },
  installations: OPEN_INSTALLATION,
} satisfies Prisma.DeviceSelect;

type DeviceListRow = Prisma.DeviceGetPayload<{ select: typeof DEVICE_LIST_ROW }>;

export function toDeviceRow({ model, installations, archivedAt, ...row }: DeviceListRow): DeviceRow {
  return { ...row, modelName: model?.name ?? null, isArchived: archivedAt !== null, place: placeOf(installations[0]) };
}

export const SIM_LIST_ROW = {
  id: true,
  version: true,
  iccid: true,
  msisdn: true,
  operatorId: true,
  planId: true,
  status: true,
  note: true,
  archivedAt: true,
  operator: { select: { name: true } },
  plan: { select: { name: true } },
  device: { select: { imei: true, installations: OPEN_INSTALLATION } },
} satisfies Prisma.SimSelect;

type SimListRow = Prisma.SimGetPayload<{ select: typeof SIM_LIST_ROW }>;

export function toSimRow({ operator, plan, device, archivedAt, ...row }: SimListRow): SimRow {
  return {
    ...row,
    operatorName: operator?.name ?? null,
    planName: plan?.name ?? null,
    deviceImei: device?.imei ?? null,
    isArchived: archivedAt !== null,
    place: placeOf(device?.installations[0]),
  };
}

const SENSOR_LIST_ROW = {
  id: true,
  version: true,
  serialNo: true,
  note: true,
  archivedAt: true,
  installations: OPEN_INSTALLATION,
} satisfies Prisma.SensorSelect;

type SensorListRow = Prisma.SensorGetPayload<{ select: typeof SENSOR_LIST_ROW }>;

function toSensorRow({ installations, archivedAt, ...row }: SensorListRow): SensorRow {
  return { ...row, isArchived: archivedAt !== null, place: placeOf(installations[0]) };
}

function deviceSearch(text: string): Prisma.DeviceWhereInput {
  const digits = text.replace(/\D/g, "");
  if (digits.length < MIN_NUMBER_SEARCH) return NOTHING;
  return { OR: [{ imei: { startsWith: digits } }, { imeiRev: { startsWith: reverseDigits(digits) } }] };
}

function simSearch(text: string): Prisma.SimWhereInput {
  const digits = text.replace(/\D/g, "");
  if (digits.length < MIN_NUMBER_SEARCH) return NOTHING;
  const reversed = reverseDigits(digits);
  return {
    OR: [
      { iccid: { startsWith: digits } },
      { iccidRev: { startsWith: reversed } },
      { msisdnRev: { startsWith: reversed } },
    ],
  };
}

function sensorSearch(text: string): Prisma.SensorWhereInput {
  const serial = normalizeName(text);
  return serial.length >= MIN_SERIAL_SEARCH ? { serialNoNorm: { contains: escapeLike(serial) } } : NOTHING;
}

// Keyset on id: uuidv7 orders by creation, and the newest is what a person has just brought in. Under AND, because a
// search that found nothing is a condition on the id as well
function pageWhere(cursor: string | undefined) {
  return cursor ? { AND: [{ id: { lt: cursor } }] } : {};
}

function pageOf<T extends { id: string }, R>(rows: T[], limit: number, toRow: (row: T) => R) {
  const page = rows.slice(0, limit);
  return {
    items: page.map(toRow),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

function archivedWhere(archived: "true" | undefined) {
  return { archivedAt: archived ? { not: null } : null };
}

function installedBy(contractorId: string | undefined) {
  return contractorId ? { installations: { some: { validTo: null, contractorId } } } : {};
}

export async function listDevices(db: DbOrTx, query: DeviceListQuery): Promise<DeviceList> {
  const { q, status, modelId, contractorId, archived, cursor, limit } = query;
  const rows = await db.device.findMany({
    where: {
      ...archivedWhere(archived),
      ...(status ? { status } : {}),
      ...(modelId ? { modelId } : {}),
      ...installedBy(contractorId),
      ...(q ? deviceSearch(q) : {}),
      ...pageWhere(cursor),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: DEVICE_LIST_ROW,
  });
  return pageOf(rows, limit, toDeviceRow);
}

export async function listSims(db: DbOrTx, query: SimListQuery): Promise<SimList> {
  const { q, status, operatorId, contractorId, archived, cursor, limit } = query;
  const rows = await db.sim.findMany({
    where: {
      ...archivedWhere(archived),
      ...(status ? { status } : {}),
      ...(operatorId ? { operatorId } : {}),
      ...(contractorId ? { installations: { some: { validTo: null, contractorId } } } : {}),
      ...(q ? simSearch(q) : {}),
      ...pageWhere(cursor),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: SIM_LIST_ROW,
  });
  return pageOf(rows, limit, toSimRow);
}

export async function listSensors(db: DbOrTx, query: SensorListQuery): Promise<SensorList> {
  const { q, contractorId, archived, cursor, limit } = query;
  const rows = await db.sensor.findMany({
    where: {
      ...archivedWhere(archived),
      ...installedBy(contractorId),
      ...(q ? sensorSearch(q) : {}),
      ...pageWhere(cursor),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: SENSOR_LIST_ROW,
  });
  return pageOf(rows, limit, toSensorRow);
}

// A free tracker is one that came off an object: in repair or written off it is no choice for a form (D71)
export async function listAvailableDevices(db: DbOrTx, { q, cursor, limit }: AvailableQuery): Promise<DeviceList> {
  const rows = await db.device.findMany({
    where: { archivedAt: null, status: "removed", ...(q ? deviceSearch(q) : {}), ...pageWhere(cursor) },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: DEVICE_LIST_ROW,
  });
  return pageOf(rows, limit, toDeviceRow);
}

export async function listAvailableSims(db: DbOrTx, { q, cursor, limit }: AvailableQuery): Promise<SimList> {
  const rows = await db.sim.findMany({
    where: { archivedAt: null, status: "free", ...(q ? simSearch(q) : {}), ...pageWhere(cursor) },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: SIM_LIST_ROW,
  });
  return pageOf(rows, limit, toSimRow);
}

export async function listAvailableSensors(db: DbOrTx, { q, cursor, limit }: AvailableQuery): Promise<SensorList> {
  const rows = await db.sensor.findMany({
    where: {
      archivedAt: null,
      installations: { none: { validTo: null } },
      ...(q ? sensorSearch(q) : {}),
      ...pageWhere(cursor),
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    select: SENSOR_LIST_ROW,
  });
  return pageOf(rows, limit, toSensorRow);
}

export async function findPlanOperator(db: DbOrTx, planId: string): Promise<string | null> {
  const plan = await db.simPlan.findUnique({ where: { id: planId }, select: { operatorId: true } });
  return plan?.operatorId ?? null;
}

// undefined: no such record. null: it is there and not in the archive.
export async function findBatchIdOf(db: DbOrTx, kind: EquipmentKind, id: string): Promise<string | null | undefined> {
  const select = { archiveBatchId: true };
  const row =
    kind === "device"
      ? await db.device.findUnique({ where: { id }, select })
      : kind === "sim"
        ? await db.sim.findUnique({ where: { id }, select })
        : await db.sensor.findUnique({ where: { id }, select });
  return row ? row.archiveBatchId : undefined;
}
