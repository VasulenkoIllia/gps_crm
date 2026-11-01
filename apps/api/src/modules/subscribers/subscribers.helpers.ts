import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { AppError } from "../../core/errors.js";
import { notFound } from "../references/index.js";
import { readObjectFacts } from "./subscribers.queries.js";
import * as repo from "./subscribers.repository.js";

export async function requireSubscriber(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.SubscriberRow> {
  const subscriber = await repo.lockSubscriber(tx, id, scope);
  if (!subscriber) throw notFound();
  return subscriber;
}

// An archived client changes only by coming back: otherwise the package restored later is not the one archived
export async function requireLiveSubscriber(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.SubscriberRow> {
  const subscriber = await requireSubscriber(tx, id, scope);
  if (subscriber.archivedAt) throw new AppError(409, "subscriber_archived", "Клієнт в архіві. Спершу відновіть його");
  return subscriber;
}

// П17, П18: in the transaction of the change to an object, under the lock of the client, so two changes cannot write what
// each of them counted before the other
export async function refreshRollup(tx: DbOrTx, subscriberId: string): Promise<void> {
  const facts = await readObjectFacts(tx, [subscriberId]);
  const counts = facts.get(subscriberId);
  if (counts) await repo.writeRollup(tx, subscriberId, counts);
}
