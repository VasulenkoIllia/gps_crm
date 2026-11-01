import { deriveSubscriberStatus, type ObjectCounts } from "@gps_crm/shared";
import type { DbOrTx } from "../../core/db/client.js";
import type { JobDefinition } from "../../core/jobs/job.js";
import { fixRollup, readRollupPage, type RollupRow } from "./subscribers.repository.js";

const PAGE_SIZE = 1_000;
// Three nights of silence, as auth.cleanup: one missed night is nothing to worry about
const MAX_SILENCE_MS = 3 * 24 * 60 * 60 * 1_000;

// Step 5 reads these from the objects. There is no table yet, and until then a client has no objects.
function readObjectFacts(): ObjectCounts {
  return { objectsActive: 0, objectsSuspended: 0, objectsDisconnected: 0 };
}

function isOutdated(row: RollupRow, facts: ObjectCounts): boolean {
  return (
    row.objectsActive !== facts.objectsActive ||
    row.objectsSuspended !== facts.objectsSuspended ||
    row.objectsDisconnected !== facts.objectsDisconnected ||
    row.status !== deriveSubscriberStatus(facts)
  );
}

// П18. A repeat finds nothing to fix, so a retry is free
export async function reconcileRollups(db: DbOrTx): Promise<{ checked: number; fixed: number }> {
  let checked = 0;
  let fixed = 0;
  let afterId: string | null = null;
  for (;;) {
    const page: RollupRow[] = await readRollupPage(db, afterId, PAGE_SIZE);
    for (const row of page) {
      const facts = readObjectFacts();
      if (!isOutdated(row, facts)) continue;
      await fixRollup(db, row, facts);
      fixed += 1;
    }
    checked += page.length;
    const last = page.at(-1);
    if (!last || page.length < PAGE_SIZE) return { checked, fixed };
    afterId = last.id;
  }
}

export const SUBSCRIBERS_ROLLUP_JOB: JobDefinition = {
  name: "subscribers.rollup-reconcile",
  title: "Звірка статусів клієнтів і лічильників об'єктів",
  cron: "30 2 * * *",
  scheduleLabel: "Щоночі о 02:30",
  maxSilenceMs: MAX_SILENCE_MS,
  canRunByHand: true,
  run: async ({ db }) => ({ summary: await reconcileRollups(db) }),
};
