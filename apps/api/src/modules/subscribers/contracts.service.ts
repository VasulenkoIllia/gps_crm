import {
  CONTRACT_FILE_TEXT,
  todayKyiv,
  type ContractCreate,
  type ContractList,
  type ContractListQuery,
  type ContractNumberCheck,
  type ContractNumberCheckQuery,
  type ContractUpdate,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivity,
  type ActivityContext,
  type ActivityEventInput,
} from "../../core/activity/activity.repository.js";
import { isUniqueViolation, type DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { detectFileType } from "../../core/files/file-type.js";
import { createFileRecord, findLatestFile, placeFile } from "../../core/files/files.repository.js";
import { assertVersion, changedFields, hasChanges, notFound } from "../references/index.js";
import { CONTRACT_OWNER } from "./contracts.files.js";
import { listContracts as readContracts, listContractsOf } from "./contracts.queries.js";
import * as repo from "./contracts.repository.js";
import { isLinked, lockPayer } from "./payers.repository.js";
import { recordArchived, requireLiveSubscriber } from "./subscribers.helpers.js";
import { findVisibleId } from "./subscribers.repository.js";

const PAYER_OF_CLIENT = "Оберіть платника цього клієнта";
const UPDATED_FIELDS = ["number", "signedOn", "validUntil", "terminatedOn", "note"] as const;

type ContractDeps = Pick<AppDeps, "db">;

function contractEvent(
  action: ActivityEventInput["action"],
  contract: { id: string; number: string; subscriberId: string },
  extra: Pick<ActivityEventInput, "changes" | "details"> = {},
): ActivityEventInput {
  return {
    action,
    entityType: "contract",
    entityId: contract.id,
    subscriberId: contract.subscriberId,
    changes: extra.changes,
    details: { label: contract.number, ...extra.details },
  };
}

function numberTaken(number: string): AppError {
  const message = `У цього платника вже є договір з номером ${number}`;
  return new AppError(409, "contract_number_taken", message, { number: message });
}

function translateNumberTaken(number: string) {
  return (error: unknown): never => {
    if (isUniqueViolation(error)) throw numberTaken(number);
    throw error;
  };
}

// П1: with the payer and for the client, so a payer of one client cannot sign for another. The payer's row stays locked,
// so it cannot leave for the archive under a contract being written.
async function requirePayerOfClient(tx: DbOrTx, payerId: string, subscriberId: string) {
  const payer = await lockPayer(tx, payerId, { managerId: null });
  if (!payer || payer.archivedAt || !(await isLinked(tx, payerId, subscriberId))) {
    throw new AppError(422, "payer_unavailable", PAYER_OF_CLIENT, { payerId: PAYER_OF_CLIENT });
  }
  return payer;
}

export function listContracts(deps: ContractDeps, query: ContractListQuery, scope: RecordScope): Promise<ContractList> {
  return readContracts(deps.db, query, scope, todayKyiv());
}

export async function listSubscriberContracts(
  deps: ContractDeps,
  scope: RecordScope,
  subscriberId: string,
): Promise<ContractList> {
  if (!(await findVisibleId(deps.db, subscriberId, scope))) throw notFound();
  return listContractsOf(deps.db, subscriberId, todayKyiv());
}

export async function checkContractNumber(
  deps: ContractDeps,
  scope: RecordScope,
  query: ContractNumberCheckQuery,
): Promise<ContractNumberCheck> {
  const holders = await repo.findNumberHolders(deps.db, scope, query.number, query.excludeId);
  const toHolder = (holder: (typeof holders)[number]) => ({
    id: holder.id,
    subscriberId: holder.subscriberId,
    payerName: holder.payer.name,
  });
  const samePayer = holders.find((holder) => holder.payerId === query.payerId);
  const otherPayer = holders.find((holder) => holder.payerId !== query.payerId);
  return {
    samePayer: samePayer ? toHolder(samePayer) : null,
    otherPayer: otherPayer ? toHolder(otherPayer) : null,
  };
}

export function createContract(
  deps: ContractDeps,
  context: ActivityContext,
  scope: RecordScope,
  subscriberId: string,
  input: ContractCreate,
): Promise<{ id: string }> {
  return deps.db
    .$transaction(async (tx) => {
      await requireLiveSubscriber(tx, subscriberId, scope);
      const payer = await requirePayerOfClient(tx, input.payerId, subscriberId);
      const id = await repo.createContract(tx, subscriberId, input, actorIdOf(context));
      const details = { payer: payer.name, signedOn: input.signedOn, validUntil: input.validUntil };
      const event = contractEvent("contract.created", { id, subscriberId, number: input.number }, { details });
      await recordActivity(tx, context, event);
      return { id };
    })
    .catch(translateNumberTaken(input.number));
}

export async function lockContract(tx: DbOrTx, id: string, scope: RecordScope): Promise<repo.ContractRow> {
  const seen = await repo.findContract(tx, id, scope);
  if (!seen) throw notFound();
  await requireLiveSubscriber(tx, seen.subscriberId, scope);
  const contract = await repo.findContract(tx, id, scope);
  if (!contract) throw notFound();
  if (contract.archivedAt) throw recordArchived();
  return contract;
}

export async function updateContract(
  deps: ContractDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ContractUpdate,
): Promise<void> {
  await deps.db
    .$transaction(async (tx) => {
      const before = await lockContract(tx, id, scope);
      assertVersion(before, input.version);
      const isNewPayer = before.payerId !== input.payerId;
      const payer = isNewPayer ? await requirePayerOfClient(tx, input.payerId, before.subscriberId) : null;
      const changes = {
        ...changedFields(before, input, [...UPDATED_FIELDS]),
        ...(payer ? { payer: [before.payerName, payer.name] as [string, string] } : {}),
      };
      if (!hasChanges(changes)) return;
      await repo.updateContract(tx, id, input, actorIdOf(context));
      await recordActivity(tx, context, contractEvent("contract.updated", { ...before, ...input }, { changes }));
    })
    .catch(translateNumberTaken(input.number));
}

export interface ContractUpload {
  fileName: string;
  content: Buffer;
}

export function fileRefused(): AppError {
  return new AppError(422, "file_refused", CONTRACT_FILE_TEXT, { file: CONTRACT_FILE_TEXT });
}

// A newer file takes over the card, and the old one stays on the disk and in the journal: a contract is evidence
export async function uploadContractFile(
  deps: Pick<AppDeps, "db" | "files" | "logger">,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  upload: ContractUpload,
): Promise<void> {
  const type = detectFileType(upload.content);
  if (!type) throw fileRefused();
  const seen = await repo.findContract(deps.db, id, scope);
  if (!seen) throw notFound();
  if (seen.archivedAt) throw recordArchived();
  const file = { ownerType: CONTRACT_OWNER, ownerId: id, originalName: upload.fileName, mime: type.mime };
  const placed = await placeFile(deps.files, { ...file, content: upload.content });
  try {
    await deps.db.$transaction(async (tx) => {
      const contract = await lockContract(tx, id, scope);
      await createFileRecord(tx, deps.files, file, placed, actorIdOf(context));
      const details = { fileName: upload.fileName };
      await recordActivity(tx, context, contractEvent("contract.file_uploaded", contract, { details }));
    });
  } catch (error) {
    await deps.files.remove(placed.key).catch((removal: unknown) => {
      deps.logger.warn({ err: removal }, "could not remove a file left by a failed upload");
    });
    throw error;
  }
}

export interface ContractFile {
  name: string;
  mime: string;
  content: Buffer;
}

export async function readContractFile(
  deps: Pick<AppDeps, "db" | "files" | "logger">,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  disposition: "inline" | "attachment",
): Promise<ContractFile> {
  const contract = await repo.findContract(deps.db, id, scope);
  if (!contract) throw notFound();
  const file = await findLatestFile(deps.db, CONTRACT_OWNER, id);
  if (!file) throw notFound();
  const content = await deps.files.read(file.key);
  if (!content) {
    deps.logger.error({ fileId: file.id }, "a file on record is missing from the storage");
    throw new AppError(404, "file_missing", "Файл не знайдено у сховищі");
  }
  const action = disposition === "inline" ? "contract.file_viewed" : "contract.file_downloaded";
  const details = { fileName: file.originalName };
  await recordActivity(deps.db, context, contractEvent(action, contract, { details }));
  return { name: file.originalName, mime: file.mime, content };
}
