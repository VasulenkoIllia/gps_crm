import { ALL_RECORDS, type RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivities,
  recordActivity,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import { isUniqueViolation, type DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import {
  dropArchiveBatches,
  lockOpenBatches,
  openArchiveBatch,
  openBatchIdsOf,
  restoreArchiveBatch,
  type ArchiveRestorer,
  type ArchiveRestorers,
} from "../activity/index.js";
import { notFound } from "../references/index.js";
import type { ClientObjects } from "./client-objects.js";
import * as contacts from "./contacts.repository.js";
import { lockContact, primaryNeeded } from "./contacts.service.js";
import * as contractsRepo from "./contracts.repository.js";
import { lockContract } from "./contracts.service.js";
import * as payers from "./payers.repository.js";
import { assertNoWorkingObjects } from "./payers.service.js";
import { refreshRollup, requireSubscriber } from "./subscribers.helpers.js";
import { countAllObjects } from "./subscribers.queries.js";
import * as repo from "./subscribers.repository.js";

type ArchiveDeps = Pick<AppDeps, "db">;
export type PackageDeps = AppDeps & { objects: ClientObjects };

interface PackageItem {
  id: string;
  label: string;
}

function itemEvents(
  action: ActivityEventInput["action"],
  entityType: string,
  items: PackageItem[],
  subscriberId: string,
): ActivityEventInput[] {
  return items.map((item) => ({
    action,
    entityType,
    entityId: item.id,
    subscriberId,
    details: { label: item.label },
  }));
}

function blocked(message: string): AppError {
  return new AppError(409, "restore_blocked", message);
}

// П19. Objects are the one count that stands in the way: disconnected ones go to the archive with their client, and let
// their equipment go there and then (D71)
export async function archiveSubscriber(
  deps: Pick<PackageDeps, "db" | "objects">,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const subscriber = await requireSubscriber(tx, id, scope);
    if (subscriber.archivedAt) return;
    const { objectsActive, objectsSuspended } = subscriber;
    if (objectsActive + objectsSuspended > 0) {
      const message = `Спершу відключіть об'єкти клієнта: активних ${objectsActive}, призупинених ${objectsSuspended}`;
      throw new AppError(409, "subscriber_has_objects", message);
    }
    const contactRows = await contacts.findActiveContacts(tx, id);
    const contractRows = await contractsRepo.findActiveContracts(tx, id);
    const payerRows = await lockedPayersOnlyOf(tx, id);
    const batchId = await openArchiveBatch(tx, context, {
      entityType: "subscriber",
      label: `Клієнт: ${subscriber.name}`,
      itemCount: 1 + contactRows.length + contractRows.length + payerRows.length + subscriber.objectsDisconnected,
      subscriberId: id,
    });
    const actorId = actorIdOf(context);
    await repo.markSubscriberArchived(tx, id, batchId, actorId);
    const objectRows = await deps.objects.archiveWithClient(tx, id, batchId, actorId);
    await refreshRollup(tx, id);
    await contacts.archiveContacts(
      tx,
      contactRows.map((row) => row.id),
      batchId,
      actorId,
    );
    await contractsRepo.archiveContracts(
      tx,
      contractRows.map((row) => row.id),
      batchId,
      actorId,
    );
    await payers.archivePayers(
      tx,
      payerRows.map((row) => row.id),
      batchId,
      actorId,
    );
    await recordActivities(tx, context, [
      ...itemEvents("subscriber.archived", "subscriber", [{ id, label: subscriber.name }], id),
      ...itemEvents("object.archived", "object", objectRows, id),
      ...itemEvents(
        "contact.archived",
        "contact",
        contactRows.map((row) => ({ id: row.id, label: row.fullName })),
        id,
      ),
      ...itemEvents(
        "contract.archived",
        "contract",
        contractRows.map((row) => ({ id: row.id, label: row.number })),
        id,
      ),
      ...itemEvents(
        "payer.archived",
        "payer",
        payerRows.map((row) => ({ id: row.id, label: row.name })),
        id,
      ),
    ]);
  });
}

export async function archiveContact(
  deps: ArchiveDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const contact = await lockContact(tx, id, scope);
    if (contact.isPrimary) throw primaryNeeded();
    const batchId = await openArchiveBatch(tx, context, {
      entityType: "contact",
      label: `Контакт: ${contact.fullName}`,
      itemCount: 1,
      subscriberId: contact.subscriberId,
    });
    await contacts.archiveContacts(tx, [id], batchId, actorIdOf(context));
    const items = [{ id, label: contact.fullName }];
    await recordActivities(tx, context, itemEvents("contact.archived", "contact", items, contact.subscriberId));
  });
}

export async function archiveContract(
  deps: ArchiveDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const contract = await lockContract(tx, id, scope);
    const batchId = await openArchiveBatch(tx, context, {
      entityType: "contract",
      label: `Договір: ${contract.number}`,
      itemCount: 1,
      subscriberId: contract.subscriberId,
    });
    await contractsRepo.archiveContracts(tx, [id], batchId, actorIdOf(context));
    const items = [{ id, label: contract.number }];
    await recordActivities(tx, context, itemEvents("contract.archived", "contract", items, contract.subscriberId));
  });
}

// payers.md П6. The package goes under the first client, as its events do.
export async function archivePayer(
  deps: ArchiveDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const payer = await payers.lockPayer(tx, id, scope);
    if (!payer) throw notFound();
    if (payer.archivedAt) return;
    await assertNoWorkingObjects(tx, id);
    const subscriberId = await payers.findFirstClientOf(tx, id, scope);
    const batchId = await openArchiveBatch(tx, context, {
      entityType: "payer",
      label: `Платник: ${payer.name}`,
      itemCount: 1,
      subscriberId,
    });
    await payers.archivePayers(tx, [id], batchId, actorIdOf(context));
    await recordActivity(tx, context, {
      action: "payer.archived",
      entityType: "payer",
      entityId: id,
      subscriberId,
      details: { label: payer.name },
    });
  });
}

// All the payers of the client, not just those that look like only theirs: two clients of one payer going to the archive
// at once each see the other alive, and without this the payer stays alive with nobody left
async function lockedPayersOnlyOf(tx: DbOrTx, id: string): Promise<{ id: string; name: string }[]> {
  await payers.lockPayers(tx, await payers.findPayerIdsOf(tx, [id]));
  return payers.findPayersOnlyOf(tx, id);
}

// As every other write: the clients first, then the payers, each by id. What is read after this is what stands
async function lockPackage(tx: DbOrTx, batchId: string): Promise<void> {
  const subscribers = await repo.findSubscribersOfBatch(tx, batchId);
  const contactRows = await contacts.findContactsOfBatch(tx, batchId);
  const payerRows = await payers.findPayersOfBatch(tx, batchId);
  const contractRows = await contractsRepo.findContractsOfBatch(tx, batchId);
  const clientIds = [
    ...subscribers.map((row) => row.id),
    ...[...contactRows, ...contractRows].map((row) => row.subscriberId),
  ];
  await repo.lockSubscribers(tx, [...new Set(clientIds)]);
  const payerIds = [
    ...payerRows.map((row) => row.id),
    ...contractRows.map((row) => row.payerId),
    // A client coming back is one more reason for the payers they share to stay
    ...(await payers.findPayerIdsOf(
      tx,
      subscribers.map((row) => row.id),
    )),
  ];
  await payers.lockPayers(tx, [...new Set(payerIds)]);
}

// A contract of another client took the number under another payer's change: the check before saw it free
function translateNumberHeld(error: unknown): never {
  if (isUniqueViolation(error)) throw blocked("Номер договору в цього платника вже зайнято");
  throw error;
}

// One restorer for all four kinds: a package holds any of them, and what stands in the way of each is the same (П20).
// Objects come back only with their client: there is a package of their own for one that went alone.
const restorePackage =
  (objects: ClientObjects): ArchiveRestorer =>
  async (tx, batchId, context) => {
    await lockPackage(tx, batchId);
    const subscribers = await repo.findSubscribersOfBatch(tx, batchId);
    const contactRows = await contacts.findContactsOfBatch(tx, batchId);
    const payerRows = await payers.findPayersOfBatch(tx, batchId);
    const contractRows = await contractsRepo.findContractsOfBatch(tx, batchId);
    const clientsBack = new Set(subscribers.map((subscriber) => subscriber.id));
    const payersBack = new Set(payerRows.map((payer) => payer.id));
    for (const contact of contactRows) {
      if (contact.subscriber.archivedAt && !clientsBack.has(contact.subscriberId)) {
        throw blocked(`Спершу відновіть клієнта «${contact.subscriber.name}»`);
      }
    }
    await assertContractsCanReturn(tx, contractRows, clientsBack, payersBack);
    const ownerOf = subscribers[0]?.id ?? contactRows[0]?.subscriberId ?? contractRows[0]?.subscriberId;
    await repo.clearSubscriberBatch(tx, batchId);
    const objectRows = await objects.restoreWithClient(tx, batchId);
    for (const { id } of subscribers) await refreshRollup(tx, id);
    await payers.clearPayerBatch(tx, batchId);
    await contacts.clearContactBatch(tx, batchId);
    await contractsRepo.clearContractBatch(tx, batchId).catch(translateNumberHeld);
    const subscriberId = ownerOf ?? (await firstClientOfPayers(tx, payerRows));
    await recordActivities(tx, context, [
      ...subscribers.map((row) => restoredEvent("subscriber.restored", "subscriber", row.id, row.name, row.id)),
      ...objectRows.map((row) => restoredEvent("object.restored", "object", row.id, row.label, row.subscriberId)),
      ...contactRows.map((row) => restoredEvent("contact.restored", "contact", row.id, row.fullName, row.subscriberId)),
      ...payerRows.map((row) => restoredEvent("payer.restored", "payer", row.id, row.name, subscriberId)),
      ...contractRows.map((row) =>
        restoredEvent("contract.restored", "contract", row.id, row.number, row.subscriberId),
      ),
    ]);
  };

function firstClientOfPayers(tx: DbOrTx, rows: { id: string }[]): Promise<string | undefined> {
  const [first] = rows;
  return first ? payers.findFirstClientOf(tx, first.id, ALL_RECORDS) : Promise.resolve(undefined);
}

function restoredEvent(
  action: ActivityEventInput["action"],
  entityType: string,
  entityId: string,
  label: string,
  subscriberId: string | undefined,
): ActivityEventInput {
  return { action, entityType, entityId, subscriberId, details: { label } };
}

async function assertContractsCanReturn(
  tx: DbOrTx,
  rows: contractsRepo.ContractOfBatch[],
  clientsBack: Set<string>,
  payersBack: Set<string>,
): Promise<void> {
  for (const contract of rows) {
    if (contract.subscriber.archivedAt && !clientsBack.has(contract.subscriberId)) {
      throw blocked(`Спершу відновіть клієнта «${contract.subscriber.name}»`);
    }
    if (contract.payer.archivedAt && !payersBack.has(contract.payerId)) {
      throw blocked(`Спершу відновіть платника «${contract.payer.name}»`);
    }
    if (await contractsRepo.isNumberHeld(tx, contract)) {
      throw blocked(`Номер договору ${contract.number} у цього платника вже зайнято`);
    }
  }
}

export function subscriberRestorers(objects: ClientObjects): ArchiveRestorers {
  const restorer = restorePackage(objects);
  return { subscriber: restorer, contact: restorer, payer: restorer, contract: restorer };
}

// A record that is not in the archive has nothing to come back from: as a second press of the button, no change
export async function restoreRecord(
  deps: Pick<PackageDeps, "db" | "objects">,
  context: ActivityContext,
  scope: RecordScope,
  batchId: string | null,
): Promise<void> {
  if (batchId) await restoreArchiveBatch(deps.db, subscriberRestorers(deps.objects), context, batchId, scope);
}

function snapshotOf(subscriber: repo.SubscriberRow) {
  const { archivedAt, ...fields } = subscriber;
  return { ...fields, archivedAt: archivedAt?.toISOString() ?? null };
}

// A package goes with its client, and a payer of other clients in it would stay in the archive with no way back
async function assertNoSharedPayerInArchive(tx: DbOrTx, id: string, ownPayerIds: string[]): Promise<void> {
  const shared = await payers.findPayerInBatches(tx, await openBatchIdsOf(tx, id), ownPayerIds);
  if (!shared) return;
  const message = `Спершу відновіть платника «${shared.name}»: він є і в інших клієнтів`;
  throw new AppError(409, "payer_in_archive", message);
}

// П21: a mistake, undone. Only what cannot hide a history: no objects, no contract even in the archive. A payer leaves
// with the client if nobody else has it, and the journal keeps the record.
export async function deleteSubscriber(
  deps: ArchiveDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    await lockOpenBatches(tx, id);
    const subscriber = await requireSubscriber(tx, id, scope);
    if ((await countAllObjects(tx, id)) > 0) {
      throw new AppError(409, "subscriber_has_objects", "Клієнта з об'єктами видалити не можна");
    }
    if ((await repo.countContracts(tx, id)) > 0) {
      throw new AppError(409, "subscriber_has_contracts", "Клієнта з договорами видалити не можна");
    }
    await payers.lockPayers(tx, await payers.findPayerIdsOf(tx, [id]));
    const payerIds = await payers.findPayerIdsLinkedOnlyTo(tx, id);
    await assertNoSharedPayerInArchive(tx, id, payerIds);
    await dropArchiveBatches(tx, id);
    await repo.deleteSubscriberRows(tx, id);
    await payers.deletePayers(tx, payerIds);
    await recordActivity(tx, context, {
      action: "subscriber.deleted",
      entityType: "subscriber",
      entityId: id,
      subscriberId: id,
      details: { label: subscriber.name, code: subscriber.code },
      snapshot: snapshotOf(subscriber),
    });
  });
}
