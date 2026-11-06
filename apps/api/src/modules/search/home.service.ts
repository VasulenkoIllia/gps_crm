import { HOME_RECENT_EVENTS, todayKyiv, type Home } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbClient } from "../../core/db/client.js";
import { CARD_VIEW, listActivity } from "../activity/index.js";
import { countObjects } from "../objects/index.js";
import { countExpiringContracts, countSubscribers } from "../subscribers/index.js";
import { readRecentRecords } from "./home.queries.js";

// What the person may see: a part without its permission stays empty and the page leaves its place out
export interface HomeScopes {
  clients: RecordScope;
  objects: RecordScope | null;
  activity: RecordScope | null;
}

// search-exports.md B: short numbers, no analytics (D24)
export async function readHome(db: DbClient, userId: string, scopes: HomeScopes, now = new Date()): Promise<Home> {
  const { clients, objects, activity } = scopes;
  const [clientCount, activeObjects, expiringContracts, recentRecords, recentActivity] = await Promise.all([
    countSubscribers(db, {}, clients),
    objects ? countObjects(db, { status: "active" }, objects) : null,
    countExpiringContracts(db, clients, todayKyiv(now)),
    readRecentRecords(db, userId, { clients, objects }, now),
    activity ? listActivity(db, { limit: HOME_RECENT_EVENTS }, activity, CARD_VIEW) : null,
  ]);
  return {
    counts: { clients: clientCount, activeObjects, expiringContracts },
    recentRecords,
    recentActivity: recentActivity?.items ?? null,
  };
}
