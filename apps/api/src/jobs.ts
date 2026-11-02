import type { JobDefinition, TaskDefinition } from "./core/jobs/job.js";
import { ACTIVITY_PARTITIONS_JOB } from "./modules/activity/index.js";
import { AUTH_CLEANUP_JOB } from "./modules/auth/index.js";
import { EXPORT_BUILD_TASK, EXPORTS_CLEANUP_JOB } from "./modules/exports/index.js";
import { SUBSCRIBERS_ROLLUP_JOB } from "./modules/subscribers/index.js";

// What is not on this list does not run (system.md П1)
export const JOBS: JobDefinition[] = [
  ACTIVITY_PARTITIONS_JOB,
  AUTH_CLEANUP_JOB,
  SUBSCRIBERS_ROLLUP_JOB,
  EXPORTS_CLEANUP_JOB,
];

// Asked for by a request, with data of its own
export const TASKS: TaskDefinition[] = [EXPORT_BUILD_TASK];
