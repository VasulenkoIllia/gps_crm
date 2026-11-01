import type {
  ActivityList,
  ActivityListQuery,
  DuplicateList,
  DuplicatesQuery,
  ManagerList,
  SubscriberCard,
  SubscriberCodeCheck,
  SubscriberCount,
  SubscriberCountQuery,
  SubscriberList,
  SubscriberListQuery,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { AppDeps } from "../../core/deps.js";
import { listActivity } from "../activity/index.js";
import { notFound } from "../references/index.js";
import * as queries from "./subscribers.queries.js";
import { findVisibleId } from "./subscribers.repository.js";

type ReadDeps = Pick<AppDeps, "db">;

export function listClients(deps: ReadDeps, query: SubscriberListQuery, scope: RecordScope): Promise<SubscriberList> {
  return queries.listSubscribers(deps.db, query, scope);
}

export function countClients(
  deps: ReadDeps,
  query: SubscriberCountQuery,
  scope: RecordScope,
): Promise<SubscriberCount> {
  return queries.countSubscribers(deps.db, query, scope);
}

export function listManagerOptions(deps: ReadDeps): Promise<ManagerList> {
  return queries.listManagers(deps.db);
}

export function checkCode(
  deps: ReadDeps,
  code: string,
  excludeId: string | undefined,
  scope: RecordScope,
): Promise<SubscriberCodeCheck> {
  return queries.checkSubscriberCode(deps.db, code, excludeId, scope);
}

export function lookUpDuplicates(deps: ReadDeps, query: DuplicatesQuery, scope: RecordScope): Promise<DuplicateList> {
  return queries.findDuplicates(deps.db, query, scope);
}

export async function readCard(deps: ReadDeps, id: string, scope: RecordScope): Promise<SubscriberCard> {
  const card = await queries.getSubscriberCard(deps.db, id, scope);
  if (!card) throw notFound();
  return card;
}

// The package a record is in: a record of someone else's client is not found, and a live one has no package
export async function findRecordBatchId(
  deps: ReadDeps,
  kind: queries.ArchivableKind,
  id: string,
  scope: RecordScope,
): Promise<string | null> {
  const batch = await queries.findRecordBatch(deps.db, kind, id, scope);
  if (batch === undefined) throw notFound();
  return batch;
}

// The journal of a card: every event that carries this client
export async function listClientActivity(
  deps: ReadDeps,
  id: string,
  query: ActivityListQuery,
  scope: RecordScope,
): Promise<ActivityList> {
  if (!(await findVisibleId(deps.db, id, scope))) throw notFound();
  return listActivity(deps.db, { ...query, subscriberId: id }, scope);
}
