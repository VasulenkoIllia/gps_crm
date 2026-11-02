import type { JobDefinition, TaskDefinition } from "../../core/jobs/job.js";
import { buildExport, cleanUpExports } from "./exports.build.js";

// Six hourly runs in a row: a missed one or two is nothing, the files are only kept longer
const MAX_SILENCE_MS = 6 * 60 * 60 * 1_000;

export const EXPORT_BUILD_TASK: TaskDefinition = {
  name: "exports.build",
  title: "Експорт в Excel",
  run: buildExport,
};

export const EXPORTS_CLEANUP_JOB: JobDefinition = {
  name: "exports.cleanup",
  title: "Видалення старих файлів експорту",
  // Every hour, at the clock change too: a run skipped or doubled then removes the same files a little later
  cron: "20 * * * *",
  scheduleLabel: "Щогодини о 20 хвилині",
  maxSilenceMs: MAX_SILENCE_MS,
  canRunByHand: true,
  run: (context) => cleanUpExports(context),
};
