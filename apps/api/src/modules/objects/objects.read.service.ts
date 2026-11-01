import type {
  ActivityList,
  ActivityListQuery,
  ObjectCard,
  ObjectCount,
  ObjectCountQuery,
  ObjectHistory,
  ObjectList,
  ObjectListQuery,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { AppDeps } from "../../core/deps.js";
import { listActivity } from "../activity/index.js";
import { notFound } from "../references/index.js";
import { getObjectCard } from "./objects.card.queries.js";
import { getObjectHistory } from "./objects.history.queries.js";
import * as queries from "./objects.queries.js";

type ReadDeps = Pick<AppDeps, "db">;

export function listObjects(deps: ReadDeps, query: ObjectListQuery, scope: RecordScope): Promise<ObjectList> {
  return queries.listObjects(deps.db, query, scope);
}

export function countObjects(deps: ReadDeps, query: ObjectCountQuery, scope: RecordScope): Promise<ObjectCount> {
  return queries.countObjects(deps.db, query, scope);
}

export async function readObjectCard(deps: ReadDeps, id: string, scope: RecordScope): Promise<ObjectCard> {
  const card = await getObjectCard(deps.db, id, scope);
  if (!card) throw notFound();
  return card;
}

async function requireVisible(deps: ReadDeps, id: string, scope: RecordScope): Promise<void> {
  if (!(await queries.findVisibleObjectId(deps.db, id, scope))) throw notFound();
}

export async function readObjectHistory(deps: ReadDeps, id: string, scope: RecordScope): Promise<ObjectHistory> {
  await requireVisible(deps, id, scope);
  return getObjectHistory(deps.db, id);
}

export async function listObjectActivity(
  deps: ReadDeps,
  id: string,
  query: ActivityListQuery,
  scope: RecordScope,
): Promise<ActivityList> {
  await requireVisible(deps, id, scope);
  return listActivity(deps.db, { ...query, entityType: "object", entityId: id }, scope);
}
