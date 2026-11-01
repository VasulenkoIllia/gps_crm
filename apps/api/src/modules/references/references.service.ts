import {
  OPERATOR_REQUIRED,
  PROGRAM_REQUIRED,
  type CreatedReference,
  type ReferenceKind,
  type ReferenceListQuery,
  type ServerCreate,
  type ServerUpdate,
  type SimpleReferenceInput,
  type SimpleReferenceKind,
  type SimpleReferenceUpdate,
  type SimPlanCreate,
  type SimPlanUpdate,
} from "@gps_crm/shared";
import { actorIdOf, type ActivityContext } from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { addCost } from "./addons.service.js";
import {
  assertVersion,
  changedFields,
  hasChanges,
  notFound,
  recordCreated,
  recordUpdated,
  requireActive,
  writeReference,
} from "./references.helpers.js";
import * as queries from "./references.queries.js";
import * as repo from "./references.repository.js";

const SERVER_HAS_TARIFFS = "У сервера вже є тарифи, тому його програму змінити не можна";

export function listReferences(db: DbOrTx, kind: ReferenceKind, query: ReferenceListQuery, canReadCost: boolean) {
  switch (kind) {
    case "servers":
      return queries.listServers(db, query, canReadCost);
    case "tariffs":
      return queries.listTariffs(db, query);
    case "addons":
      return queries.listAddons(db, query, canReadCost);
    case "sim-plans":
      return queries.listSimPlans(db, query, canReadCost);
    default:
      return queries.listSimple(db, kind, query);
  }
}

export function createSimple(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  kind: SimpleReferenceKind,
  input: SimpleReferenceInput,
): Promise<CreatedReference> {
  return writeReference(deps, kind, async (tx) => {
    const { id } = await repo.createSimple(tx, kind, input, actorIdOf(context));
    await recordCreated(tx, context, kind, id, input.name);
    return { id };
  });
}

export async function updateSimple(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  kind: SimpleReferenceKind,
  id: string,
  input: SimpleReferenceUpdate,
): Promise<void> {
  await writeReference(deps, kind, async (tx) => {
    const before = await repo.findSimple(tx, kind, id);
    if (!before) throw notFound();
    const { version, ...values } = input;
    assertVersion(before, version);
    const changes = changedFields(before, { ...before, ...values }, ["name", "note", "sortOrder"]);
    if (!hasChanges(changes)) return;
    await repo.updateRecord(tx, kind, { id }, values, actorIdOf(context));
    await recordUpdated(tx, context, kind, id, input.name, changes);
  });
}

export function createServer(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  input: ServerCreate,
): Promise<CreatedReference> {
  return writeReference(deps, "servers", async (tx) => {
    const { firstCost, ...fields } = input;
    const program = await requireActive(tx, "programs", input.programId, "programId", PROGRAM_REQUIRED);
    const { id } = await repo.createServer(tx, fields, actorIdOf(context));
    await recordCreated(tx, context, "servers", id, input.name, { program: program.name, url: input.url });
    if (firstCost) await addCost(tx, context, { type: "server", id, name: input.name }, firstCost);
    return { id };
  });
}

// The foreign key of tariffs points at the server and its program together, so a server with tariffs stays where it is
async function programMove(
  tx: DbOrTx,
  id: string,
  before: { programId: string; program: { name: string } },
  programId: string,
): Promise<[string, string] | null> {
  if (before.programId === programId) return null;
  const program = await requireActive(tx, "programs", programId, "programId", PROGRAM_REQUIRED);
  if ((await repo.countServerTariffs(tx, id)) > 0) {
    throw new AppError(409, "server_has_tariffs", SERVER_HAS_TARIFFS, { programId: SERVER_HAS_TARIFFS });
  }
  return [before.program.name, program.name];
}

export async function updateServer(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  id: string,
  input: ServerUpdate,
): Promise<void> {
  await writeReference(deps, "servers", async (tx) => {
    const before = await repo.findServer(tx, id);
    if (!before) throw notFound();
    const { version, ...values } = input;
    assertVersion(before, version);
    const moved = await programMove(tx, id, before, input.programId);
    const changes = {
      ...changedFields(before, { ...before, ...input }, ["name", "url"]),
      ...(moved ? { program: moved } : {}),
    };
    if (!hasChanges(changes)) return;
    await repo.updateRecord(tx, "servers", { id }, values, actorIdOf(context));
    await recordUpdated(tx, context, "servers", id, input.name, changes);
  });
}

export function createSimPlan(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  input: SimPlanCreate,
): Promise<CreatedReference> {
  return writeReference(deps, "sim-plans", async (tx) => {
    const { firstCost, ...fields } = input;
    const operator = await requireActive(tx, "sim-operators", input.operatorId, "operatorId", OPERATOR_REQUIRED);
    const { id } = await repo.createSimPlan(tx, fields, actorIdOf(context));
    await recordCreated(tx, context, "sim-plans", id, input.name, { operator: operator.name });
    if (firstCost) await addCost(tx, context, { type: "sim_plan", id, name: input.name }, firstCost);
    return { id };
  });
}

export async function updateSimPlan(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  id: string,
  input: SimPlanUpdate,
): Promise<void> {
  await writeReference(deps, "sim-plans", async (tx) => {
    const before = await repo.findSimPlan(tx, id);
    if (!before) throw notFound();
    const { version, ...values } = input;
    assertVersion(before, version);
    const isMoved = before.operatorId !== input.operatorId;
    const operator = isMoved
      ? await requireActive(tx, "sim-operators", input.operatorId, "operatorId", OPERATOR_REQUIRED)
      : null;
    const changes = {
      ...changedFields(before, { ...before, ...input }, ["name", "note", "sortOrder"]),
      ...(operator ? { operator: [before.operator.name, operator.name] as [string, string] } : {}),
    };
    if (!hasChanges(changes)) return;
    await repo.updateRecord(tx, "sim-plans", { id }, values, actorIdOf(context));
    await recordUpdated(tx, context, "sim-plans", id, input.name, changes);
  });
}
