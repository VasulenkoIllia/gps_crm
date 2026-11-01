import { REFERENCE_ENTITY_TYPES, type ReferenceKind } from "@gps_crm/shared";
import { recordActivity, type ActivityContext } from "../../core/activity/activity.repository.js";
import { isUniqueViolation, type DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import * as repo from "./references.repository.js";

export type FieldChanges = Record<string, [unknown, unknown]>;

const NAME_TAKEN: Record<ReferenceKind, string> = {
  programs: "Така програма вже є",
  servers: "Такий сервер у цій програмі вже є",
  tariffs: "Такий тариф на цьому сервері вже є",
  addons: "Така послуга вже є",
  "tracker-models": "Така модель уже є",
  "sim-operators": "Такий оператор уже є",
  "sim-plans": "Такий тариф у цього оператора вже є",
  contractors: "Такий підрядник уже є",
  "disconnect-reasons": "Така причина вже є",
};

export function notFound(): AppError {
  return new AppError(404, "not_found", "Не знайдено");
}

export function recordArchived(): AppError {
  return new AppError(409, "record_archived", "Запис в архіві. Спершу відновіть його");
}

// Every change of a reference list: the lock first, and a taken name comes back as the text of its list
export function writeReference<T>(
  deps: Pick<AppDeps, "db">,
  kind: ReferenceKind,
  work: (tx: DbOrTx) => Promise<T>,
): Promise<T> {
  return deps.db
    .$transaction(async (tx) => {
      await repo.lockReferences(tx);
      return work(tx);
    })
    .catch((error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      const message = NAME_TAKEN[kind];
      throw new AppError(409, "name_taken", message, { name: message });
    });
}

// Someone saved the form while it stood open here: their change must not be overwritten unseen (03-data-model.md §3.1)
export function assertVersion(record: { version: number }, version: number): void {
  if (record.version !== version) {
    throw new AppError(409, "version_conflict", "Запис щойно змінив хтось інший. Оновіть сторінку й спробуйте ще раз");
  }
}

export function changedFields<K extends string>(
  before: Record<K, unknown>,
  after: Record<K, unknown>,
  fields: K[],
): FieldChanges {
  const changes: FieldChanges = {};
  for (const field of fields) {
    if (before[field] !== after[field]) changes[field] = [before[field], after[field]];
  }
  return changes;
}

export function hasChanges(changes: FieldChanges): boolean {
  return Object.keys(changes).length > 0;
}

// A parent named in a form: gone or deactivated, it reads the same to the person choosing
export async function requireActive(
  tx: DbOrTx,
  kind: ReferenceKind,
  id: string,
  field: string,
  message: string,
): Promise<repo.NamedRecord> {
  const parent = await repo.findNamed(tx, kind, id);
  if (!parent?.isActive) throw new AppError(422, "parent_unavailable", message, { [field]: message });
  return parent;
}

export function recordCreated(
  tx: DbOrTx,
  context: ActivityContext,
  kind: ReferenceKind,
  id: string,
  name: string,
  details: Record<string, string | number | null> = {},
): Promise<void> {
  return recordActivity(tx, context, {
    action: "reference.created",
    entityType: REFERENCE_ENTITY_TYPES[kind],
    entityId: id,
    details: { label: name, ...details },
  });
}

export function recordUpdated(
  tx: DbOrTx,
  context: ActivityContext,
  kind: ReferenceKind,
  id: string,
  name: string,
  changes: FieldChanges,
): Promise<void> {
  return recordActivity(tx, context, {
    action: "reference.updated",
    entityType: REFERENCE_ENTITY_TYPES[kind],
    entityId: id,
    details: { label: name },
    changes,
  });
}
