import { isLivePeriod, type ObjectHistory } from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate } from "../../core/db/dates.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { HISTORY_MAX } from "./objects.queries.js";

const NEWEST_FIRST = [
  { validFrom: "desc" },
  { id: "desc" },
] satisfies Prisma.DeviceInstallationOrderByWithRelationInput[];

function datesOf<T extends { validFrom: Date; validTo: Date | null }>({ validFrom, validTo, ...row }: T) {
  return { ...row, validFrom: fromDbDate(validFrom), validTo: validTo && fromDbDate(validTo) };
}

async function readEquipmentHistory(db: DbOrTx, objectId: string) {
  const window = { orderBy: NEWEST_FIRST, take: HISTORY_MAX };
  const dates = { id: true, validFrom: true, validTo: true, contractor: { select: { name: true } } };
  const [devices, sensors] = await Promise.all([
    db.deviceInstallation.findMany({
      ...window,
      where: { objectId },
      select: {
        ...dates,
        device: {
          select: {
            id: true,
            imei: true,
            model: { select: { name: true } },
            simInstallations: {
              ...window,
              select: { ...dates, sim: { select: { iccid: true } } },
            },
          },
        },
      },
    }),
    db.sensorInstallation.findMany({
      ...window,
      where: { objectId },
      select: { ...dates, sensor: { select: { serialNo: true } } },
    }),
  ]);
  return { devices, sensors };
}

type EquipmentHistory = Awaited<ReturnType<typeof readEquipmentHistory>>;

// A SIM stands in a tracker, so its history on this object is what fell inside that tracker's time here
function simsOnObject(devices: EquipmentHistory["devices"]): ObjectHistory["sims"] {
  return devices.flatMap((installation) => {
    const stood = datesOf(installation);
    return installation.device.simInstallations.flatMap((simInstallation) => {
      const sim = datesOf(simInstallation);
      const isInside = sim.validFrom >= stood.validFrom && (stood.validTo === null || sim.validFrom <= stood.validTo);
      if (!isInside) return [];
      return [
        {
          id: sim.id,
          validFrom: sim.validFrom,
          validTo: sim.validTo,
          contractorName: sim.contractor?.name ?? null,
          iccid: sim.sim.iccid,
          imei: installation.device.imei,
        },
      ];
    });
  });
}

async function readStatusHistory(db: DbOrTx, objectId: string): Promise<ObjectHistory["statuses"]> {
  const rows = await db.objectStatusPeriod.findMany({
    where: { objectId },
    orderBy: NEWEST_FIRST,
    take: HISTORY_MAX,
    select: {
      id: true,
      status: true,
      validFrom: true,
      validTo: true,
      note: true,
      reason: { select: { name: true } },
    },
  });
  return rows.map(datesOf).map(({ reason, ...row }) => ({ ...row, reasonName: reason?.name ?? null }));
}

async function readTermHistory(db: DbOrTx, objectId: string): Promise<ObjectHistory["terms"]> {
  const rows = await db.objectServiceTerm.findMany({
    where: { objectId },
    orderBy: NEWEST_FIRST,
    take: HISTORY_MAX,
    select: {
      id: true,
      validFrom: true,
      validTo: true,
      payer: { select: { name: true } },
      ownTariff: { select: { name: true } },
    },
  });
  return rows
    .map(datesOf)
    .filter(isLivePeriod)
    .map(({ payer, ownTariff, ...row }) => ({
      ...row,
      payerName: payer.name,
      ownTariffName: ownTariff?.name ?? null,
    }));
}

async function readAddonHistory(db: DbOrTx, objectId: string): Promise<ObjectHistory["addons"]> {
  const rows = await db.objectAddonPeriod.findMany({
    where: { objectId },
    orderBy: NEWEST_FIRST,
    take: HISTORY_MAX,
    select: { id: true, validFrom: true, validTo: true, addon: { select: { name: true } } },
  });
  return rows.map(datesOf).map(({ addon, ...row }) => ({ ...row, addonName: addon.name }));
}

export async function getObjectHistory(db: DbOrTx, objectId: string): Promise<ObjectHistory> {
  const [statuses, terms, addons, equipment] = await Promise.all([
    readStatusHistory(db, objectId),
    readTermHistory(db, objectId),
    readAddonHistory(db, objectId),
    readEquipmentHistory(db, objectId),
  ]);
  return {
    statuses,
    terms,
    addons,
    devices: equipment.devices.map(datesOf).map(({ id, validFrom, validTo, contractor, device }) => ({
      id,
      validFrom,
      validTo,
      contractorName: contractor?.name ?? null,
      imei: device.imei,
      modelName: device.model?.name ?? null,
    })),
    sims: simsOnObject(equipment.devices),
    sensors: equipment.sensors.map(datesOf).map(({ sensor, contractor, ...row }) => ({
      ...row,
      contractorName: contractor?.name ?? null,
      serialNo: sensor.serialNo,
    })),
  };
}
