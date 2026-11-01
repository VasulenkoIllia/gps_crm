import { z } from "zod";
import type { StatusMeta } from "./users.ts";

export const SYSTEM_STATE = { good: "good", warning: "warning", critical: "critical", waiting: "waiting" } as const;

export type SystemState = (typeof SYSTEM_STATE)[keyof typeof SYSTEM_STATE];

// Green, yellow, red: always with a word and an icon (system.md §5). The word comes with the block: it says what is wrong
export const SYSTEM_STATE_TONES: Record<SystemState, StatusMeta["tone"]> = {
  good: "good",
  warning: "warning",
  critical: "critical",
  waiting: "pending",
};

const stateSchema = z.enum([SYSTEM_STATE.good, SYSTEM_STATE.warning, SYSTEM_STATE.critical, SYSTEM_STATE.waiting]);

const verdictSchema = z.strictObject({ state: stateSchema, label: z.string() });
export type SystemVerdict = z.infer<typeof verdictSchema>;

export const backupStatusSchema = z.strictObject({
  dump: verdictSchema.extend({
    lastOkAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    dumpBytes: z.number().nullable(),
    copies: z.number().nullable(),
  }),
  restoreCheck: verdictSchema.extend({
    lastOkAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    tables: z.number().nullable(),
  }),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

export const systemStatusSchema = z.strictObject({
  checkedAt: z.string(),
  backups: backupStatusSchema,
  queueState: verdictSchema,
  queues: z.array(
    z.strictObject({
      name: z.string(),
      label: z.string(),
      waiting: z.number(),
      active: z.number(),
      deferred: z.number(),
      failed: z.number(),
    }),
  ),
  database: z.strictObject({
    sizeBytes: z.number(),
    tables: z.array(z.strictObject({ name: z.string(), sizeBytes: z.number() })),
  }),
  disk: verdictSchema.extend({
    usedPercent: z.number().nullable(),
    freeBytes: z.number().nullable(),
    totalBytes: z.number().nullable(),
  }),
  version: z.strictObject({
    current: z.string().nullable(),
    deployments: z.array(
      z.strictObject({ version: z.string(), previousVersion: z.string().nullable(), deployedAt: z.string() }),
    ),
  }),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

export const jobRunSchema = z.strictObject({
  id: z.string(),
  trigger: z.enum(["schedule", "manual"]),
  isSuccess: z.boolean(),
  startedAt: z.string(),
  finishedAt: z.string(),
  skippedItems: z.number(),
  error: z.string().nullable(),
});
export type JobRun = z.infer<typeof jobRunSchema>;

export const JOB_RUN_RESULTS = {
  success: { label: "Успішно", tone: "good" },
  failure: { label: "Збій", tone: "critical" },
} as const satisfies Record<string, StatusMeta>;

export const jobListSchema = z.strictObject({
  items: z.array(
    verdictSchema.extend({
      name: z.string(),
      title: z.string(),
      scheduleLabel: z.string(),
      canRunByHand: z.boolean(),
      lastSuccessAt: z.string().nullable(),
      failureStreak: z.number(),
      skippedItems: z.number(),
      lastError: z.string().nullable(),
      runs: z.array(jobRunSchema),
    }),
  ),
});
export type JobList = z.infer<typeof jobListSchema>;
export type JobListItem = JobList["items"][number];

export const jobNameParamsSchema = z.strictObject({ name: z.string().regex(/^[a-z][a-z.-]{1,60}$/) });
