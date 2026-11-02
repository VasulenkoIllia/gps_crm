import { z } from "zod";
import { contractFiltersSchema } from "./contracts.ts";
import { deviceFiltersSchema, sensorFiltersSchema, simFiltersSchema } from "./equipment.ts";
import { OBJECT_SORTS, objectCountQuerySchema } from "./objects.ts";
import { SORT_ORDERS, SUBSCRIBER_SORTS, subscriberCountQuerySchema } from "./subscribers.ts";

// The lists that go to Excel (search-exports.md C, D69), with the names of their files and of the journal
export const EXPORT_ENTITIES = {
  subscribers: "Клієнти",
  objects: "Об'єкти",
  devices: "Трекери",
  sims: "SIM-картки",
  sensors: "Датчики",
  contracts: "Договори",
} as const;
export type ExportEntity = keyof typeof EXPORT_ENTITIES;
const EXPORT_ENTITY_KEYS = Object.keys(EXPORT_ENTITIES) as ExportEntity[];

// П1
export const EXPORT_FILE_HOURS = 24;
// A sheet of Excel holds 1 048 576 rows, and one of them is the header
export const EXPORT_ROWS_MAX = 1_048_575;

export const EXPORT_STATUSES = ["queued", "running", "done", "failed", "expired"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

// The filters of the screen as the list takes them, and its sort: the file has the rows in the order of the screen
export const exportRequestSchema = z.discriminatedUnion("entity", [
  z.strictObject({
    entity: z.literal("subscribers"),
    filters: subscriberCountQuerySchema,
    sort: z.enum(SUBSCRIBER_SORTS).default("name"),
    order: z.enum(SORT_ORDERS).default("asc"),
  }),
  z.strictObject({
    entity: z.literal("objects"),
    filters: objectCountQuerySchema,
    sort: z.enum(OBJECT_SORTS).default("createdAt"),
    order: z.enum(SORT_ORDERS).default("desc"),
  }),
  z.strictObject({ entity: z.literal("devices"), filters: deviceFiltersSchema }),
  z.strictObject({ entity: z.literal("sims"), filters: simFiltersSchema }),
  z.strictObject({ entity: z.literal("sensors"), filters: sensorFiltersSchema }),
  z.strictObject({ entity: z.literal("contracts"), filters: contractFiltersSchema }),
]);
export type ExportRequest = z.infer<typeof exportRequestSchema>;

export const exportJobSchema = z.strictObject({
  id: z.string(),
  entity: z.enum(EXPORT_ENTITY_KEYS),
  status: z.enum(EXPORT_STATUSES),
  rowCount: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;
