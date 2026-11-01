import type { PayerCreate, PayerList, PayerSearchQuery, PayerUpdate } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivity,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { assertVersion, changedFields, hasChanges, notFound } from "../references/index.js";
import { listPayersOf, searchPayers } from "./payers.queries.js";
import * as repo from "./payers.repository.js";
import { recordArchived, requireLiveSubscriber } from "./subscribers.helpers.js";
import { findVisibleId } from "./subscribers.repository.js";

const UPDATED_FIELDS = [
  "name",
  "paymentMethod",
  "legalName",
  "taxId",
  "vchasnoEmail",
  "detailsContact",
  "paymentTermsNote",
  "note",
] as const;

type PayerDeps = Pick<AppDeps, "db">;

function payerEvent(
  action: ActivityEventInput["action"],
  payer: { id: string; name: string },
  subscriberId: string | undefined,
  changes?: ActivityEventInput["changes"],
): ActivityEventInput {
  return { action, entityType: "payer", entityId: payer.id, subscriberId, details: { label: payer.name }, changes };
}

export async function listSubscriberPayers(
  deps: PayerDeps,
  scope: RecordScope,
  subscriberId: string,
): Promise<PayerList> {
  if (!(await findVisibleId(deps.db, subscriberId, scope))) throw notFound();
  return listPayersOf(deps.db, subscriberId, scope);
}

export function searchPayerList(deps: PayerDeps, query: PayerSearchQuery, scope: RecordScope): Promise<PayerList> {
  return searchPayers(deps.db, query, scope);
}

export function createPayer(
  deps: PayerDeps,
  context: ActivityContext,
  scope: RecordScope,
  subscriberId: string,
  input: PayerCreate,
): Promise<{ id: string }> {
  return deps.db.$transaction(async (tx) => {
    await requireLiveSubscriber(tx, subscriberId, scope);
    const actorId = actorIdOf(context);
    const id = await repo.createPayer(tx, input, actorId);
    await repo.linkPayer(tx, id, subscriberId, actorId);
    await recordActivity(tx, context, payerEvent("payer.created", { id, name: input.name }, subscriberId));
    return { id };
  });
}

async function requireLivePayer(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.PayerRow> {
  const payer = await repo.lockPayer(tx, id, scope);
  if (!payer) throw notFound();
  if (payer.archivedAt) throw recordArchived();
  return payer;
}

// П11. The level `own` brings in only a payer it can see: linking one by id would open its details to this person
export async function linkPayerToSubscriber(
  deps: PayerDeps,
  context: ActivityContext,
  scope: RecordScope,
  subscriberId: string,
  payerId: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    await requireLiveSubscriber(tx, subscriberId, scope);
    const payer = await requireLivePayer(tx, payerId, scope);
    if (await repo.linkPayer(tx, payerId, subscriberId, actorIdOf(context))) {
      await recordActivity(tx, context, payerEvent("payer.linked", payer, subscriberId));
    }
  });
}

export async function unlinkPayerFromSubscriber(
  deps: PayerDeps,
  context: ActivityContext,
  scope: RecordScope,
  subscriberId: string,
  payerId: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    await requireLiveSubscriber(tx, subscriberId, scope);
    const payer = await repo.lockPayer(tx, payerId, scope);
    if (!payer) throw notFound();
    const contracts = await repo.countContracts(tx, payerId, subscriberId);
    if (contracts > 0) {
      const message = `За платником у цього клієнта є договори, також в архіві (${contracts}): спершу перенесіть їх на іншого платника`;
      throw new AppError(409, "payer_in_use", message);
    }
    if (await repo.unlinkPayer(tx, payerId, subscriberId)) {
      await recordActivity(tx, context, payerEvent("payer.unlinked", payer, subscriberId));
    }
  });
}

export async function updatePayer(
  deps: PayerDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: PayerUpdate,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const before = await requireLivePayer(tx, id, scope);
    assertVersion(before, input.version);
    const changes = changedFields(before, input, [...UPDATED_FIELDS]);
    if (!hasChanges(changes)) return;
    await repo.updatePayer(tx, id, input, actorIdOf(context));
    const subscriberId = await repo.findFirstClientOf(tx, id, scope);
    await recordActivity(tx, context, payerEvent("payer.updated", { id, name: input.name }, subscriberId, changes));
  });
}
