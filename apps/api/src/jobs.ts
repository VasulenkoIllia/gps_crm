import type { JobDefinition } from "./core/jobs/job.js";
import { ACTIVITY_PARTITIONS_JOB } from "./modules/activity/index.js";
import { AUTH_CLEANUP_JOB } from "./modules/auth/index.js";

// What is not on this list does not run (system.md П1)
export const JOBS: JobDefinition[] = [ACTIVITY_PARTITIONS_JOB, AUTH_CLEANUP_JOB];
