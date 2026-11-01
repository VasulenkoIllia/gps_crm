import {
  COST_SUBJECT_TYPES,
  PROGRAM_REQUIRED,
  REFERENCE_ENTITY_TYPES,
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
  notFound,
  recordCreated,
  recordUpdated,
  writeReference,
} from "./references.helpers.js";
import * as repo from "./references.repository.js";

const PRICE_TOO_EARLY = "Нова ціна не може діяти раніше за чинну";
const PRICE_DATE_TAKEN = "На цю дату ціна вже є";

const COST_SUBJECT_KINDS: Record<(typeof COST_SUBJECT_TYPES)[number], ReferenceKind> = {
  server: "servers",
  sim_plan: "sim-plans",
  addon: "addons",
};

// The history only grows at its end, so a row never changes and two periods cannot overlap (references.md П3)
function assertAfterLast(last: string | null, validFrom: string): void {
  if (!last || validFrom > last) return;
  if (validFrom === last)
    throw new AppError(409, "price_date_taken", PRICE_DATE_TAKEN, { validFrom: PRICE_DATE_TAKEN });
  throw new AppError(422, "price_too_early", PRICE_TOO_EARLY, { validFrom: PRICE_TOO_EARLY });
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
  assertAfterLast(await repo.lastCostDate(tx, subject.type, subject.id), price.validFrom);
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
    assertAfterLast(await repo.lastAddonPriceDate(tx, id), price.validFrom);
    await repo.addAddonPriceRow(tx, id, price, actorIdOf(context));
    await recordActivity(tx, context, {
      action: "reference.price_added",
      entityType: REFERENCE_ENTITY_TYPES.addons,
      entityId: id,
      details: { label: addon.name, priceKop: price.amountKop, validFrom: price.validFrom },
    });
  });
}
