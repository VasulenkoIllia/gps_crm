import {
  SUBSCRIBER_TYPE_KEYS,
  type IdSeries,
  type IdSeriesCreate,
  type IdSeriesList,
  type IdSeriesUpdate,
  type SubscriberType,
} from "@gps_crm/shared";
import { actorIdOf, recordActivity, type ActivityContext } from "../../core/activity/activity.repository.js";
import { isUniqueViolation, type DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { assertVersion, changedFields, hasChanges, notFound } from "../references/index.js";
import * as repo from "./id-series.repository.js";

const NAME_TAKEN = "Така серія вже є";
const IN_USE = "Серію з типами клієнтів видалити не можна: спершу перенесіть типи в іншу серію";
const SERIES_FIELDS = ["name", "rangeFrom", "rangeTo", "nextNumber"] as const;

// Each change is one package: the lock, the check of the whole set, the journal
function writeSeries<T>(deps: Pick<AppDeps, "db">, work: (tx: DbOrTx) => Promise<T>): Promise<T> {
  return deps.db
    .$transaction(async (tx) => {
      await repo.lockIdSeries(tx);
      return work(tx);
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      throw new AppError(409, "name_taken", NAME_TAKEN, { name: NAME_TAKEN });
    });
}

type SeriesRange = Pick<IdSeriesCreate, "rangeFrom" | "rangeTo">;

// The exclusion in the database has the last word, here it gets the words of the module doc
function assertNoOverlap(all: IdSeries[], input: SeriesRange, ownId: string | null): void {
  const other = all.find(
    (series) => series.id !== ownId && series.rangeFrom <= input.rangeTo && input.rangeFrom <= series.rangeTo,
  );
  if (!other) return;
  const message = `Діапазон перетинається із серією «${other.name}»`;
  throw new AppError(422, "series_overlap", message, { rangeFrom: message });
}

// Naming a type moves it from the series that holds it (the form warns about that), so a type is never in two. What is
// left to check is a type taken out of a series and put nowhere.
function assertEveryTypeHasSeries(types: SubscriberType[]): void {
  const missing = SUBSCRIBER_TYPE_KEYS.find((type) => !types.includes(type));
  if (!missing) return;
  const message = `Тип ${missing} не має серії`;
  throw new AppError(422, "type_without_series", message, { types: message });
}

async function allAssignedTypes(tx: DbOrTx): Promise<SubscriberType[]> {
  return (await repo.listIdSeries(tx)).flatMap((series) => series.types);
}

export async function listIdSeries(deps: Pick<AppDeps, "db">): Promise<IdSeriesList> {
  return { items: await repo.listIdSeries(deps.db) };
}

export function createIdSeries(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  input: IdSeriesCreate,
): Promise<{ id: string }> {
  return writeSeries(deps, async (tx) => {
    assertNoOverlap(await repo.listIdSeries(tx), input, null);
    const id = await repo.createIdSeries(tx, input, actorIdOf(context));
    await repo.assignTypes(tx, id, input.types);
    await recordActivity(tx, context, {
      action: "id_series.created",
      entityType: "id_series",
      entityId: id,
      details: {
        label: input.name,
        rangeFrom: input.rangeFrom,
        rangeTo: input.rangeTo,
        nextNumber: input.nextNumber,
        types: input.types.join(", "),
      },
    });
    return { id };
  });
}

async function replaceTypes(tx: DbOrTx, before: IdSeries, input: IdSeriesUpdate): Promise<void> {
  for (const type of before.types.filter((held) => !input.types.includes(held))) await repo.removeType(tx, type);
  await repo.assignTypes(tx, before.id, input.types);
  assertEveryTypeHasSeries(await allAssignedTypes(tx));
}

function typeChanges(before: IdSeries, input: IdSeriesUpdate): Record<string, [unknown, unknown]> {
  const after = [...input.types].sort();
  const isSame = before.types.join() === after.join();
  return isSame ? {} : { types: [before.types.join(", "), after.join(", ")] };
}

export async function updateIdSeries(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  id: string,
  input: IdSeriesUpdate,
): Promise<void> {
  await writeSeries(deps, async (tx) => {
    await repo.lockSeries(tx, id);
    const before = await repo.findIdSeries(tx, id);
    if (!before) throw notFound();
    assertVersion(before, input.version);
    assertNoOverlap(await repo.listIdSeries(tx), input, id);
    const changes = { ...changedFields(before, input, [...SERIES_FIELDS]), ...typeChanges(before, input) };
    if (!hasChanges(changes)) return;
    await repo.updateIdSeries(tx, id, input, actorIdOf(context));
    await replaceTypes(tx, before, input);
    await recordActivity(tx, context, {
      action: "id_series.updated",
      entityType: "id_series",
      entityId: id,
      details: { label: input.name },
      changes,
    });
  });
}

export async function deleteIdSeries(deps: Pick<AppDeps, "db">, context: ActivityContext, id: string): Promise<void> {
  await writeSeries(deps, async (tx) => {
    const series = await repo.findIdSeries(tx, id);
    if (!series) throw notFound();
    if (series.types.length > 0) throw new AppError(409, "series_in_use", IN_USE);
    await repo.deleteIdSeries(tx, id);
    await recordActivity(tx, context, {
      action: "id_series.deleted",
      entityType: "id_series",
      entityId: id,
      details: { label: series.name, rangeFrom: series.rangeFrom, rangeTo: series.rangeTo },
    });
  });
}
