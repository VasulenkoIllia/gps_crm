import type { IdSeries, IdSeriesCreate, IdSeriesUpdate, SubscriberType } from "@gps_crm/shared";
import { normalizeName } from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import type { Prisma } from "../../generated/prisma/client.js";

// Any number that no other advisory lock of the app uses: see lockReferences
const ID_SERIES_LOCK = 7_204_005;

const SERIES_SELECT = {
  id: true,
  version: true,
  name: true,
  rangeFrom: true,
  rangeTo: true,
  nextNumber: true,
  types: { select: { type: true }, orderBy: { type: "asc" } },
} satisfies Prisma.SubscriberIdSeriesSelect;

type RawSeries = Prisma.SubscriberIdSeriesGetPayload<{ select: typeof SERIES_SELECT }>;

function toSeries({ rangeFrom, rangeTo, nextNumber, types, ...row }: RawSeries): IdSeries {
  return {
    ...row,
    rangeFrom: Number(rangeFrom),
    rangeTo: Number(rangeTo),
    nextNumber: Number(nextNumber),
    types: types.map(({ type }) => type),
    numbersLeft: Number(rangeTo - nextNumber + 1n),
  };
}

// A change looks at all the series at once (the overlap, a type left out), and rows it has yet to see cannot be locked.
// Only those changes wait here: taking a number locks the row of one series.
export async function lockIdSeries(tx: DbOrTx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ID_SERIES_LOCK}::bigint)`;
}

export async function listIdSeries(db: DbOrTx): Promise<IdSeries[]> {
  const rows = await db.subscriberIdSeries.findMany({ orderBy: { rangeFrom: "asc" }, select: SERIES_SELECT });
  return rows.map(toSeries);
}

export async function findIdSeries(db: DbOrTx, id: string): Promise<IdSeries | null> {
  const row = await db.subscriberIdSeries.findUnique({ where: { id }, select: SERIES_SELECT });
  return row && toSeries(row);
}

export async function lockSeries(tx: DbOrTx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM subscriber_id_series WHERE id = ${id}::uuid FOR NO KEY UPDATE`;
}

// The row stays locked to the end of the creation: the next client of this series waits for this one's number
export async function lockSeriesOfType(tx: DbOrTx, type: SubscriberType): Promise<IdSeries | null> {
  // The series that was locked, read from this query: a type moved meanwhile must not lead to a row without the lock
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT s.id::text AS id FROM subscriber_id_series s
    JOIN subscriber_id_series_types t ON t.series_id = s.id
    WHERE t.type = ${type}::subscriber_type
    FOR NO KEY UPDATE OF s
  `;
  return locked ? findIdSeries(tx, locked.id) : null;
}

// With the version: a form opened before this number carries the old one, and must not turn the counter back
export async function advanceSeries(tx: DbOrTx, id: string, nextNumber: number): Promise<void> {
  await tx.subscriberIdSeries.update({
    where: { id },
    data: { nextNumber: BigInt(nextNumber), version: { increment: 1 } },
  });
}

function rangeColumns(input: Pick<IdSeriesCreate, "name" | "rangeFrom" | "rangeTo" | "nextNumber">) {
  return {
    name: input.name,
    nameNorm: normalizeName(input.name),
    rangeFrom: BigInt(input.rangeFrom),
    rangeTo: BigInt(input.rangeTo),
    nextNumber: BigInt(input.nextNumber),
  };
}

export async function createIdSeries(tx: DbOrTx, input: IdSeriesCreate, createdBy: string | null): Promise<string> {
  const data = { ...rangeColumns(input), createdBy, updatedBy: createdBy };
  const { id } = await tx.subscriberIdSeries.create({ data, select: { id: true } });
  return id;
}

export async function updateIdSeries(
  tx: DbOrTx,
  id: string,
  input: IdSeriesUpdate,
  updatedBy: string | null,
): Promise<void> {
  await tx.subscriberIdSeries.update({
    where: { id },
    data: { ...rangeColumns(input), updatedBy, version: { increment: 1 } },
  });
}

export async function assignTypes(tx: DbOrTx, seriesId: string, types: SubscriberType[]): Promise<void> {
  // A series a type leaves has changed too: a form of it opened before would take the type back
  await tx.subscriberIdSeries.updateMany({
    where: { id: { not: seriesId }, types: { some: { type: { in: types } } } },
    data: { version: { increment: 1 } },
  });
  for (const type of types) {
    await tx.subscriberIdSeriesType.upsert({ where: { type }, create: { type, seriesId }, update: { seriesId } });
  }
}

export async function removeType(tx: DbOrTx, type: SubscriberType): Promise<void> {
  await tx.subscriberIdSeriesType.delete({ where: { type } });
}

export async function deleteIdSeries(tx: DbOrTx, id: string): Promise<void> {
  await tx.subscriberIdSeries.delete({ where: { id } });
}
