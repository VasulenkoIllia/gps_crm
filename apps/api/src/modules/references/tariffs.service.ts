import {
  PROGRAM_REQUIRED,
  REFERENCE_ENTITY_TYPES,
  SERVER_REQUIRED,
  type CreatedReference,
  type TariffCreate,
  type TariffUpdate,
  type TariffVersionInput,
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
  recordUpdated,
  requireActive,
  writeReference,
  type FieldChanges,
} from "./references.helpers.js";
import * as repo from "./references.repository.js";

const TARIFF_IN_USE = "Тариф уже використовується. Для нової ціни створіть нову версію тарифу";

// What a client's bill rests on. A name is only a word: it can still be corrected on a tariff in use (references.md П9)
const FROZEN_FIELDS = ["programId", "serverId", "billingModel", "priceKop"] as const;

type TariffPlace = Pick<TariffCreate, "programId" | "serverId">;

// The database refuses this too (a foreign key on both columns): here it gets the words of the module doc
async function requirePlace(tx: DbOrTx, place: TariffPlace) {
  const program = await requireActive(tx, "programs", place.programId, "programId", PROGRAM_REQUIRED);
  const server = await repo.findServer(tx, place.serverId);
  if (!server?.isActive) {
    throw new AppError(422, "parent_unavailable", SERVER_REQUIRED, { serverId: SERVER_REQUIRED });
  }
  if (server.programId !== program.id) {
    const message = `Цей сервер не належить програмі ${program.name}`;
    throw new AppError(422, "server_not_in_program", message, { serverId: message });
  }
  return { program, server };
}

function tariffInUse(fields: readonly string[]): AppError {
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, TARIFF_IN_USE]));
  return new AppError(409, "tariff_in_use", TARIFF_IN_USE, fieldErrors);
}

export function createTariff(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  input: TariffCreate,
): Promise<CreatedReference> {
  return writeReference(deps, "tariffs", async (tx) => {
    const { program, server } = await requirePlace(tx, input);
    const { id } = await repo.createTariff(tx, input, actorIdOf(context));
    await recordActivity(tx, context, {
      action: "reference.created",
      entityType: REFERENCE_ENTITY_TYPES.tariffs,
      entityId: id,
      details: {
        label: input.name,
        program: program.name,
        server: server.name,
        billingModel: input.billingModel,
        priceKop: input.priceKop,
      },
    });
    return { id };
  });
}

// `selectedAt: null` in the write as well as the check here: a client's form can take the tariff in between, and its
// transaction does not wait for this lock
async function writeFrozenFields(
  tx: DbOrTx,
  context: ActivityContext,
  id: string,
  input: TariffUpdate,
  frozen: readonly string[],
): Promise<void> {
  const { name, programId, serverId, billingModel } = input;
  const values = { name, programId, serverId, billingModel, priceKop: repo.toPriceColumn(input.priceKop) };
  const count = await repo.updateRecord(tx, "tariffs", { id, selectedAt: null }, values, actorIdOf(context));
  if (count === 0) throw tariffInUse(frozen);
}

async function placeChanges(tx: DbOrTx, before: repo.TariffRow, input: TariffUpdate): Promise<FieldChanges> {
  if (before.programId === input.programId && before.serverId === input.serverId) return {};
  const { program, server } = await requirePlace(tx, input);
  return {
    ...(before.programId === input.programId ? {} : { program: [before.programName, program.name] }),
    ...(before.serverId === input.serverId ? {} : { server: [before.serverName, server.name] }),
  };
}

export async function updateTariff(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  id: string,
  input: TariffUpdate,
): Promise<void> {
  await writeReference(deps, "tariffs", async (tx) => {
    const before = await repo.findTariff(tx, id);
    if (!before) throw notFound();
    assertVersion(before, input.version);
    const frozen = FROZEN_FIELDS.filter((field) => before[field] !== input[field]);
    if (frozen.length > 0 && before.isSelected) throw tariffInUse(frozen);
    const changes = {
      ...changedFields(before, input, ["name", "billingModel", "priceKop"]),
      ...(await placeChanges(tx, before, input)),
    };
    if (!hasChanges(changes)) return;
    if (frozen.length > 0) await writeFrozenFields(tx, context, id, input, frozen);
    else await repo.updateRecord(tx, "tariffs", { id }, { name: input.name }, actorIdOf(context));
    await recordUpdated(tx, context, "tariffs", id, input.name, changes);
  });
}

// П9: the old tariff stays with whoever is on it. Only the name and the price are new, the rest comes from it.
export function createTariffVersion(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  sourceId: string,
  input: TariffVersionInput,
): Promise<CreatedReference> {
  return writeReference(deps, "tariffs", async (tx) => {
    const source = await repo.findTariff(tx, sourceId);
    if (!source) throw notFound();
    await requirePlace(tx, source);
    const { programId, serverId, billingModel } = source;
    const fields = { programId, serverId, billingModel, ...input };
    const { id } = await repo.createTariff(tx, fields, actorIdOf(context));
    await recordActivity(tx, context, {
      action: "reference.tariff_version_created",
      entityType: REFERENCE_ENTITY_TYPES.tariffs,
      entityId: id,
      details: { label: input.name, basedOn: source.name, priceKop: input.priceKop },
    });
    return { id };
  });
}
