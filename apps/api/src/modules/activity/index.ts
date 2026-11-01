export { ACTIVITY_PARTITIONS_JOB } from "./activity.jobs.js";
export { registerActivityRoutes } from "./activity.routes.js";
export {
  dropArchiveBatches,
  listActivity,
  lockOpenBatches,
  openArchiveBatch,
  openBatchIdsOf,
  restoreArchiveBatch,
  type ArchiveRestorer,
  type ArchiveRestorers,
} from "./activity.service.js";

export const OWNED_TABLES = ["archive_batches"];
