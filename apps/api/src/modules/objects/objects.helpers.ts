import type { ActivityEventInput } from "../../core/activity/activity.repository.js";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { AppError } from "../../core/errors.js";
import { notFound, recordArchived } from "../references/index.js";
import { lockSubscribers } from "../subscribers/index.js";
import * as repo from "./objects.repository.js";

type EventFields = Pick<ActivityEventInput, "details" | "changes" | "snapshot">;

// Every line about an object goes under the object, so that its card and the journal of the client both find it
export function objectEvent(
  action: ActivityEventInput["action"],
  object: { id: string; name: string; subscriberId: string },
  { details, ...fields }: EventFields = {},
): ActivityEventInput {
  return {
    action,
    entityType: "object",
    entityId: object.id,
    subscriberId: object.subscriberId,
    details: { label: object.name, ...details },
    ...fields,
  };
}

// The client before the object, as every write that hangs off a client: the status and the counts of the client change
// with it, and a client going to the archive reads them under the same lock
export async function lockObject(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.ObjectRow> {
  const subscriberId = await repo.findClientOf(tx, id, scope);
  if (!subscriberId) throw notFound();
  await lockSubscribers(tx, [subscriberId]);
  const object = await repo.lockRow(tx, id);
  if (!object) throw notFound();
  return object;
}

export async function lockLiveObject(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.ObjectRow> {
  const object = await lockObject(tx, id, scope);
  if (object.archivedAt) throw recordArchived();
  return object;
}

// П8
export async function lockWorkingObject(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.ObjectRow> {
  const object = await lockLiveObject(tx, id, scope);
  if (object.status === "disconnected") throw objectDisconnected();
  return object;
}

export function objectDisconnected(): AppError {
  return new AppError(
    409,
    "object_disconnected",
    "Відключений об'єкт не можна змінювати: спершу підключіть його знову",
  );
}
