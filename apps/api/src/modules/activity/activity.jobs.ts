import { ensureActivityPartitions } from "../../core/activity/activity.repository.js";
import type { JobDefinition } from "../../core/jobs/job.js";

// A month and a half: the default partition takes the rows in the meantime, so red here is a warning and not a loss
const MAX_SILENCE_MS = 45 * 24 * 60 * 60 * 1_000;

export const ACTIVITY_PARTITIONS_JOB: JobDefinition = {
  name: "activity.partitions",
  title: "Партиції журналу дій",
  // After the UTC month has turned, and clear of the clock change
  cron: "30 5 1 * *",
  scheduleLabel: "1-го числа о 05:30",
  maxSilenceMs: MAX_SILENCE_MS,
  canRunByHand: true,
  // Stranded rows are not lost, and the run went through: the screen shows them as elements left out
  run: async ({ db }) => {
    const { created, stranded } = await ensureActivityPartitions(db);
    return { summary: { created }, skippedItems: stranded };
  },
};
