import {
  isLivePeriod,
  objectTariffOn,
  periodOn,
  todayKyiv,
  type ObjectCard,
  type ObjectTariffFact,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { fromDbDate } from "../../core/db/dates.js";
import { AppError } from "../../core/errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { findTariffFact, HISTORY_MAX, type TariffFact } from "./objects.queries.js";
import { objectWhere } from "./objects.repository.js";

const INSTALLATION = {
  validFrom: true,
  contractor: { select: { name: true } },
} satisfies Prisma.DeviceInstallationSelect;

const CARD_ROW = {
  id: true,
  version: true,
  name: true,
  subscriberId: true,
  status: true,
  statusFrom: true,
  connectedOn: true,
  disconnectedOn: true,
  tariffId: true,
  hasOwnTariff: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  subscriber: { select: { code: true, name: true } },
  disconnectReason: { select: { name: true } },
  addonPeriods: {
    where: { validTo: null },
    orderBy: { validFrom: "asc" },
    select: { addonId: true, validFrom: true, addon: { select: { name: true } } },
  },
  sensorInstallations: {
    where: { validTo: null },
    select: { ...INSTALLATION, sensor: { select: { id: true, serialNo: true } } },
  },
  currentDevice: {
    select: {
      id: true,
      imei: true,
      model: { select: { name: true } },
      installations: { where: { validTo: null }, select: INSTALLATION },
      currentSim: {
        select: {
          id: true,
          iccid: true,
          msisdn: true,
          operator: { select: { name: true } },
          plan: { select: { name: true } },
          installations: { where: { validTo: null }, select: INSTALLATION },
        },
      },
    },
  },
} satisfies Prisma.MonitoredObjectSelect;

type CardRow = Prisma.MonitoredObjectGetPayload<{ select: typeof CARD_ROW }>;

type InstallationRow = Prisma.DeviceInstallationGetPayload<{ select: typeof INSTALLATION }>;

function installedFacts(row: InstallationRow | undefined) {
  return {
    installedOn: row ? fromDbDate(row.validFrom) : "",
    contractorName: row?.contractor?.name ?? null,
  };
}

function deviceFact({ currentDevice }: CardRow): ObjectCard["device"] {
  if (!currentDevice) return null;
  const { id, imei, model, installations } = currentDevice;
  return { id, imei, modelName: model?.name ?? null, ...installedFacts(installations[0]) };
}

function simFact({ currentDevice }: CardRow): ObjectCard["sim"] {
  const sim = currentDevice?.currentSim;
  if (!sim) return null;
  const { id, iccid, msisdn, operator, plan, installations } = sim;
  return {
    id,
    iccid,
    msisdn,
    operatorName: operator?.name ?? null,
    planName: plan?.name ?? null,
    ...installedFacts(installations[0]),
  };
}

interface DatedTerm {
  payerId: string;
  ownTariffId: string | null;
  validFrom: string;
  validTo: string | null;
  payer: { name: string };
}

async function readTerms(db: DbOrTx, objectId: string): Promise<DatedTerm[]> {
  const rows = await db.objectServiceTerm.findMany({
    where: { objectId },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    take: HISTORY_MAX,
    select: {
      payerId: true,
      ownTariffId: true,
      validFrom: true,
      validTo: true,
      payer: { select: { name: true } },
    },
  });
  return rows.map(({ validFrom, validTo, ...row }) => ({
    ...row,
    validFrom: fromDbDate(validFrom),
    validTo: validTo && fromDbDate(validTo),
  }));
}

async function readClientPeriods(db: DbOrTx, subscriberId: string) {
  const rows = await db.subscriberTariffPeriod.findMany({
    where: { subscriberId },
    orderBy: [{ validFrom: "desc" }, { id: "desc" }],
    take: HISTORY_MAX,
    select: { tariffId: true, validFrom: true, validTo: true },
  });
  return rows.map(({ tariffId, validFrom, validTo }) => ({
    tariffId,
    validFrom: fromDbDate(validFrom),
    validTo: validTo && fromDbDate(validTo),
  }));
}

// П24: the program a date stands in, which is not the one of the row when a version is planned ahead of it (D70)
export async function findTariffOn(
  db: DbOrTx,
  { id, subscriberId, tariffId }: { id: string; subscriberId: string; tariffId: string },
  date: string,
): Promise<TariffFact> {
  const terms = await readTerms(db, id);
  const periods = await readClientPeriods(db, subscriberId);
  return findTariffFact(db, objectTariffOn(date, terms, periods)?.tariffId ?? tariffId);
}

// A payer may run through several versions: the date a person wants is the one it began on
function payerFrom(terms: DatedTerm[], current: DatedTerm): string {
  let from = current.validFrom;
  for (const term of terms.filter(isLivePeriod)) {
    if (term.validFrom >= from) continue;
    if (term.payerId !== current.payerId) break;
    from = term.validFrom;
  }
  return from;
}

function publicFact({ tariffId, tariffName, programId, programName, serverName }: TariffFact, isOwn: boolean) {
  return { tariffId, tariffName, programId, programName, serverName, isOwn } satisfies ObjectTariffFact;
}

// D70: the row mirrors the newest version, the card shows what holds today and what comes after it
async function readServiceFacts(db: DbOrTx, row: CardRow) {
  const today = todayKyiv();
  const [terms, periods] = await Promise.all([readTerms(db, row.id), readClientPeriods(db, row.subscriberId)]);
  const current = objectTariffOn(today, terms, periods) ?? { tariffId: row.tariffId, isOwn: row.hasOwnTariff };
  const tariff = publicFact(await findTariffFact(db, current.tariffId), current.isOwn);
  const term = periodOn(terms, today) ?? terms.filter(isLivePeriod).at(-1);
  const isSame = row.tariffId === current.tariffId && row.hasOwnTariff === current.isOwn;
  const open = terms.find((version) => version.validTo === null);
  const clientOpen = periods.find((period) => period.validTo === null);
  const planned = open && open.validFrom > today ? open : clientOpen;
  const nextTariff =
    isSame || !planned
      ? null
      : { ...publicFact(await findTariffFact(db, row.tariffId), row.hasOwnTariff), validFrom: planned.validFrom };
  if (!term) throw new AppError(409, "terms_missing", "Об'єкт не має чинних умов");
  return { tariff, nextTariff, payerId: term.payerId, payerName: term.payer.name, payerFrom: payerFrom(terms, term) };
}

export async function getObjectCard(db: DbOrTx, id: string, scope: RecordScope): Promise<ObjectCard | null> {
  const row = await db.monitoredObject.findFirst({ where: { id, ...objectWhere(scope) }, select: CARD_ROW });
  if (!row) return null;
  const { subscriber, addonPeriods, sensorInstallations, statusFrom, connectedOn, disconnectedOn } = row;
  return {
    id,
    version: row.version,
    name: row.name,
    subscriberId: row.subscriberId,
    subscriberCode: Number(subscriber.code),
    subscriberName: subscriber.name,
    status: row.status,
    statusFrom: fromDbDate(statusFrom),
    connectedOn: fromDbDate(connectedOn),
    disconnectedOn: disconnectedOn && fromDbDate(disconnectedOn),
    disconnectReasonName: row.disconnectReason?.name ?? null,
    ...(await readServiceFacts(db, row)),
    addons: addonPeriods.map(({ addonId, validFrom, addon }) => ({
      addonId,
      addonName: addon.name,
      validFrom: fromDbDate(validFrom),
    })),
    device: deviceFact(row),
    sim: simFact(row),
    sensors: sensorInstallations.map(({ sensor, ...installation }) => ({
      id: sensor.id,
      serialNo: sensor.serialNo,
      ...installedFacts(installation),
    })),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    isArchived: row.archivedAt !== null,
  };
}
