import {
  COST_SUBJECT_TYPES,
  dateText,
  PROGRAM_REQUIRED,
  REFERENCE_ENTITY_TYPES,
  todayKyiv,
  type AddonCreate,
  type AddonUpdate,
  type CostPriceInput,
  type CostSubjectType,
  type CreatedReference,
  type DatedPrice,
  type ReferenceKind,
} from "@gps_crm/shared";
import { actorIdOf, recordActivity, type ActivityContext } from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import {
  assertVersion,
  changedFields,
  hasChanges,
  lockedReferences,
  notFound,
  recordCreated,
  recordUpdated,
  writeReference,
} from "./references.helpers.js";
import * as repo from "./references.repository.js";

// The word for the sum as its screen says it: the price of an addon, the cost of a server or an addon, the cost of a
// plan of an operator, which that screen calls «вартість» (references.md §5)
type PriceNoun = "ціна" | "собівартість" | "вартість";
const SALE_PRICE: PriceNoun = "ціна";

const priceTooEarly = (noun: PriceNoun) => `Нова ${noun} не може діяти раніше за чинну`;
const priceDateTaken = (noun: PriceNoun) => `На цю дату ${noun} вже є`;
const priceStarted = (noun: PriceNoun) => `Ця ${noun} вже діє: видалити можна лише заплановану`;
const plannedIsLater = (date: string) =>
  `Уже є запланована з ${dateText(date)}: нова має діяти пізніше. Помилкову заплановану видаліть в історії`;

const COST_SUBJECT_KINDS: Record<(typeof COST_SUBJECT_TYPES)[number], ReferenceKind> = {
  server: "servers",
  sim_plan: "sim-plans",
  addon: "addons",
};

const COST_NOUNS: Record<CostSubjectType, PriceNoun> = {
  server: "собівартість",
  sim_plan: "вартість",
  addon: "собівартість",
};

// The history only grows at its end, so a row never changes and two periods cannot overlap (references.md П3)
function assertAfterLast(last: string | null, validFrom: string, noun: PriceNoun): void {
  if (!last || validFrom > last) return;
  if (validFrom === last) {
    const message = priceDateTaken(noun);
    throw new AppError(409, "price_date_taken", message, { validFrom: message });
  }
  const message = last > todayKyiv() ? plannedIsLater(last) : priceTooEarly(noun);
  throw new AppError(422, "price_too_early", message, { validFrom: message });
}

interface PlannedPrice {
  kind: ReferenceKind;
  noun: PriceNoun;
  subjectId: string;
  amountKop: number;
  validFrom: string;
}

// A price typed in by mistake goes before it starts; what was in force stays (D87). Under the lock of the lists, so a
// price added at the same moment sees the history without it.
async function cancelPlanned(
  tx: DbOrTx,
  context: ActivityContext,
  price: PlannedPrice,
  action: "reference.price_cancelled" | "reference.cost_cancelled",
  remove: () => Promise<void>,
): Promise<void> {
  if (price.validFrom <= todayKyiv()) throw new AppError(409, "price_started", priceStarted(price.noun));
  const subject = await repo.findNamed(tx, price.kind, price.subjectId);
  if (!subject) throw notFound();
  await remove();
  const amountField = action === "reference.price_cancelled" ? "priceKop" : "costKop";
  await recordActivity(tx, context, {
    action,
    entityType: REFERENCE_ENTITY_TYPES[price.kind],
    entityId: subject.id,
    details: { label: subject.name, [amountField]: price.amountKop, validFrom: price.validFrom },
  });
}

export async function cancelAddonPrice(deps: Pick<AppDeps, "db">, context: ActivityContext, id: string) {
  await lockedReferences(deps, async (tx) => {
    const price = await repo.findAddonPrice(tx, id);
    if (!price) throw notFound();
    const planned = { kind: "addons" as const, noun: SALE_PRICE, subjectId: price.addonId, ...price };
    await cancelPlanned(tx, context, planned, "reference.price_cancelled", () => repo.deleteAddonPriceRow(tx, id));
  });
}

export async function cancelCostPrice(deps: Pick<AppDeps, "db">, context: ActivityContext, id: string) {
  await lockedReferences(deps, async (tx) => {
    const cost = await repo.findCostPrice(tx, id);
    if (!cost) throw notFound();
    const planned = { kind: COST_SUBJECT_KINDS[cost.subjectType], noun: COST_NOUNS[cost.subjectType], ...cost };
    await cancelPlanned(tx, context, planned, "reference.cost_cancelled", () => repo.deleteCostRow(tx, id));
  });
}

// Programs an addon newly gets must be working ones; one it already has stays, though it was deactivated since
async function requirePrograms(tx: DbOrTx, programIds: string[], kept: string[]) {
  const programs = await repo.findPrograms(tx, programIds);
  const usable = new Set(programs.filter(({ id, isActive }) => isActive || kept.includes(id)).map(({ id }) => id));
  if (!programIds.every((id) => usable.has(id))) {
    throw new AppError(422, "parent_unavailable", PROGRAM_REQUIRED, { programIds: PROGRAM_REQUIRED });
  }
  return programs;
}

function namesOf(programs: { name: string }[]): string {
  return programs
    .map(({ name }) => name)
    .sort((left, right) => left.localeCompare(right, "uk"))
    .join(", ");
}

export async function addCost(
  tx: DbOrTx,
  context: ActivityContext,
  subject: { type: CostSubjectType; id: string; name: string },
  price: DatedPrice,
): Promise<void> {
  assertAfterLast(await repo.lastCostDate(tx, subject.type, subject.id), price.validFrom, COST_NOUNS[subject.type]);
  await repo.addCostRow(tx, subject.type, subject.id, price, actorIdOf(context));
  await recordActivity(tx, context, {
    action: "reference.cost_added",
    entityType: REFERENCE_ENTITY_TYPES[COST_SUBJECT_KINDS[subject.type]],
    entityId: subject.id,
    details: { label: subject.name, costKop: price.amountKop, validFrom: price.validFrom },
  });
}

export async function addCostPrice(deps: Pick<AppDeps, "db">, context: ActivityContext, input: CostPriceInput) {
  const { subjectType, subjectId, ...price } = input;
  const kind = COST_SUBJECT_KINDS[subjectType];
  await writeReference(deps, kind, async (tx) => {
    const subject = await repo.findNamed(tx, kind, subjectId);
    if (!subject) throw notFound();
    await addCost(tx, context, { type: subjectType, id: subject.id, name: subject.name }, price);
  });
}

export function createAddon(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  input: AddonCreate,
): Promise<CreatedReference> {
  return writeReference(deps, "addons", async (tx) => {
    const programs = await requirePrograms(tx, input.programIds, []);
    const actorId = actorIdOf(context);
    const { id } = await repo.createAddon(tx, input.name, actorId);
    await repo.replaceAddonPrograms(tx, id, input.programIds);
    await repo.addAddonPriceRow(tx, id, input.price, actorId);
    await recordCreated(tx, context, "addons", id, input.name, {
      programs: namesOf(programs),
      priceKop: input.price.amountKop,
      validFrom: input.price.validFrom,
    });
    if (input.firstCost) await addCost(tx, context, { type: "addon", id, name: input.name }, input.firstCost);
    return { id };
  });
}

export async function updateAddon(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  id: string,
  input: AddonUpdate,
): Promise<void> {
  await writeReference(deps, "addons", async (tx) => {
    const before = await repo.findAddon(tx, id);
    if (!before) throw notFound();
    assertVersion(before, input.version);
    const current = before.programs.map(({ program }) => program);
    const programs = await requirePrograms(
      tx,
      input.programIds,
      current.map((program) => program.id),
    );
    const changes = changedFields(
      { name: before.name, programs: namesOf(current) },
      { name: input.name, programs: namesOf(programs) },
      ["name", "programs"],
    );
    if (!hasChanges(changes)) return;
    await repo.updateRecord(tx, "addons", { id }, { name: input.name }, actorIdOf(context));
    if (changes.programs) await repo.replaceAddonPrograms(tx, id, input.programIds);
    await recordUpdated(tx, context, "addons", id, input.name, changes);
  });
}

export async function addAddonPrice(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  id: string,
  price: DatedPrice,
): Promise<void> {
  await writeReference(deps, "addons", async (tx) => {
    const addon = await repo.findNamed(tx, "addons", id);
    if (!addon) throw notFound();
    assertAfterLast(await repo.lastAddonPriceDate(tx, id), price.validFrom, SALE_PRICE);
    await repo.addAddonPriceRow(tx, id, price, actorIdOf(context));
    await recordActivity(tx, context, {
      action: "reference.price_added",
      entityType: REFERENCE_ENTITY_TYPES.addons,
      entityId: id,
      details: { label: addon.name, priceKop: price.amountKop, validFrom: price.validFrom },
    });
  });
}
