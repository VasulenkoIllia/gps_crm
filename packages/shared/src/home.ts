import { z } from "zod";
import { activityListSchema } from "./activity.ts";
import { subscriberCountSchema } from "./subscribers.ts";

// What the start page shows of each (search-exports.md B)
export const HOME_RECENT_RECORDS = 8;
export const HOME_RECENT_EVENTS = 10;

// Capped as the counts of the lists: a whole table is not counted for a number on a start page (06-quality.md §6.1)
const countSchema = subscriberCountSchema;

const recentRecordSchema = z.strictObject({
  kind: z.enum(["subscriber", "object"]),
  id: z.string(),
  name: z.string(),
  // The client's ID: of the client itself, or of the client the object belongs to
  subscriberCode: z.number(),
  changedAt: z.string(),
  isArchived: z.boolean(),
});
export type RecentRecord = z.infer<typeof recentRecordSchema>;

// null: the person may not see this, and the page leaves its place out
export const homeSchema = z.strictObject({
  counts: z.strictObject({
    clients: countSchema,
    activeObjects: countSchema.nullable(),
    expiringContracts: countSchema,
  }),
  recentRecords: z.array(recentRecordSchema),
  recentActivity: activityListSchema.shape.items.nullable(),
});
export type Home = z.infer<typeof homeSchema>;
