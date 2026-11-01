import {
  activityEntityLabel,
  REFERENCE_ENTITY_TYPES,
  REFERENCE_KINDS,
  type ActivityEntityType,
  type ReferenceKind,
} from "@gps_crm/shared";
import {
  actorIdOf,
  recordActivities,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { openArchiveBatch, type ArchiveRestorer, type ArchiveRestorers } from "../activity/index.js";
import { notFound, writeReference } from "./references.helpers.js";
import * as repo from "./references.repository.js";

interface Dependent {
  kind: ReferenceKind;
  parentField: string;
}

interface PackageItem extends repo.NamedRecord {
  kind: ReferenceKind;
}

// A server of a program that is out, or a tariff of a server that is out, could still be chosen: they leave together
const DEPENDENTS: Partial<Record<ReferenceKind, Dependent[]>> = {
  programs: [
    { kind: "servers", parentField: "programId" },
    { kind: "tariffs", parentField: "programId" },
  ],
  servers: [{ kind: "tariffs", parentField: "serverId" }],
  "sim-operators": [{ kind: "sim-plans", parentField: "operatorId" }],
};

function packageKinds(kind: ReferenceKind): ReferenceKind[] {
  return [kind, ...(DEPENDENTS[kind] ?? []).map((dependent) => dependent.kind)];
}

function journalEvent(action: ActivityEventInput["action"], item: PackageItem): ActivityEventInput {
  return {
    action,
    entityType: REFERENCE_ENTITY_TYPES[item.kind],
    entityId: item.id,
    details: { label: item.name },
  };
}

async function findDependents(tx: DbOrTx, kind: ReferenceKind, id: string): Promise<PackageItem[]> {
  const items: PackageItem[] = [];
  for (const dependent of DEPENDENTS[kind] ?? []) {
    const rows = await repo.findActiveChildren(tx, dependent.kind, dependent.parentField, id);
    items.push(...rows.map((row) => ({ ...row, kind: dependent.kind })));
  }
  return items;
}

// П4. Not a deletion: the record stays in whatever already uses it, leaves the choice in new forms, and the archive holds
// the way back. Deactivating what is already out changes nothing, as a second press of the button should.
export async function deactivateReference(
  deps: Pick<AppDeps, "db">,
  context: ActivityContext,
  kind: ReferenceKind,
  id: string,
): Promise<void> {
  await writeReference(deps, kind, async (tx) => {
    const record = await repo.findNamed(tx, kind, id);
    if (!record) throw notFound();
    if (!record.isActive) return;
    const items: PackageItem[] = [{ ...record, kind }, ...(await findDependents(tx, kind, id))];
    const entityType = REFERENCE_ENTITY_TYPES[kind];
    const batchId = await openArchiveBatch(tx, context, {
      entityType,
      label: `${activityEntityLabel(entityType)}: ${record.name}`,
      itemCount: items.length,
    });
    for (const packageKind of packageKinds(kind)) {
      const ids = items.filter((item) => item.kind === packageKind).map((item) => item.id);
      if (ids.length > 0) await repo.deactivateRecords(tx, packageKind, ids, batchId, actorIdOf(context));
    }
    await recordActivities(
      tx,
      context,
      items.map((item) => journalEvent("reference.deactivated", item)),
    );
  });
}

function restoreBlocked(parent: repo.InactiveParent): AppError {
  const label = activityEntityLabel(REFERENCE_ENTITY_TYPES[parent.kind] satisfies ActivityEntityType);
  return new AppError(409, "restore_blocked", `Спочатку відновіть запис «${label}: ${parent.name}»`);
}

// All back or none: the restore of the archive holds the transaction, and a refusal here undoes the whole package
async function restoreBatch(tx: DbOrTx, kind: ReferenceKind, batchId: string, context: ActivityContext): Promise<void> {
  await repo.lockReferences(tx);
  const items: PackageItem[] = [];
  for (const packageKind of packageKinds(kind)) {
    const rows = await repo.findInBatch(tx, packageKind, batchId);
    items.push(...rows.map((row) => ({ ...row, kind: packageKind })));
    await repo.activateBatch(tx, packageKind, batchId, actorIdOf(context));
  }
  const idsOf = (wanted: ReferenceKind) => items.filter((item) => item.kind === wanted).map((item) => item.id);
  const inactiveParent = await repo.findInactiveParent(tx, {
    servers: idsOf("servers"),
    tariffs: idsOf("tariffs"),
    "sim-plans": idsOf("sim-plans"),
  });
  if (inactiveParent) throw restoreBlocked(inactiveParent);
  await recordActivities(
    tx,
    context,
    items.map((item) => journalEvent("reference.restored", item)),
  );
}

function restorerOf(kind: ReferenceKind): ArchiveRestorer {
  return (tx, batchId, context) => restoreBatch(tx, kind, batchId, context);
}

export const REFERENCE_RESTORERS: ArchiveRestorers = Object.fromEntries(
  REFERENCE_KINDS.map((kind) => [REFERENCE_ENTITY_TYPES[kind], restorerOf(kind)]),
);
