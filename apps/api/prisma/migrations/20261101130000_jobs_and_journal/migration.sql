-- CreateTable
CREATE TABLE "archive_batches" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "entity_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "item_count" INTEGER NOT NULL,
    "archived_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_by" UUID,
    "restored_at" TIMESTAMPTZ,
    "restored_by" UUID,

    CONSTRAINT "archive_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_health" (
    "name" TEXT NOT NULL,
    "registered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "running_since" TIMESTAMPTZ,
    "last_success_at" TIMESTAMPTZ,
    "last_failure_at" TIMESTAMPTZ,
    "failure_streak" INTEGER NOT NULL DEFAULT 0,
    "skipped_items" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "job_health_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "job_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "job_name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "is_success" BOOLEAN NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL,
    "finished_at" TIMESTAMPTZ NOT NULL,
    "skipped_items" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "archive_batches_restored_at_id_idx" ON "archive_batches"("restored_at", "id" DESC);

-- CreateIndex
CREATE INDEX "job_events_job_name_id_idx" ON "job_events"("job_name", "id" DESC);

-- CreateIndex
CREATE INDEX "activity_events_actor_id_occurred_at_id_idx" ON "activity_events"("actor_id", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "activity_events_action_occurred_at_id_idx" ON "activity_events"("action", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "activity_events_entity_type_occurred_at_id_idx" ON "activity_events"("entity_type", "occurred_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "activity_events_entity_id_occurred_at_id_idx" ON "activity_events"("entity_id", "occurred_at" DESC, "id" DESC);


-- Objects outside the Prisma schema. Registered in src/core/db/schema-invariants.int.test.ts.

-- Partial, and so outside schema.prisma: most of the journal has no client, and an entry for each of those rows would
-- cost as much as a full index for a filter that only asks about a client.
CREATE INDEX "activity_events_subscriber_id_occurred_at_id_idx" ON "activity_events"("subscriber_id", "occurred_at" DESC, "id" DESC)
  WHERE "subscriber_id" IS NOT NULL;

-- The job activity.partitions calls this (activity.md П6). The runtime role has no DDL, so it runs as the schema owner,
-- and only the runtime role may call it. In public and not in part: the runtime role has no reason to reach that schema.
-- Bounds are UTC months whatever the session says, so they meet the partitions the migrations made.
-- Rows of a month with no partition sit in the default partition, and ATTACH refuses to leave them there. They move here
-- with the default locked first, so that no new one lands between the move and the attach. Reads of the journal wait for
-- that moment, which ATTACH makes as long as a scan of the default: 5 s is only how long this waits for the lock, and it
-- gives up then rather than hold up the app behind a long query, and the job tries again. The default stays cheap while
-- it stays empty, so the function also says how many rows are stranded there, and the job shows them on the screen.
CREATE FUNCTION public.ensure_activity_partitions(months_ahead integer)
RETURNS TABLE (created integer, stranded bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET "TimeZone" = 'UTC'
SET lock_timeout = '5s'
AS $$
DECLARE
  first_month timestamptz := date_trunc('month', now());
  month_start timestamptz;
  month_end timestamptz;
  partition_name text;
BEGIN
  created := 0;
  IF months_ahead IS NULL OR months_ahead NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'months_ahead must be from 1 to 12';
  END IF;
  FOR month_offset IN 0..months_ahead LOOP
    month_start := first_month + make_interval(months => month_offset);
    month_end := month_start + interval '1 month';
    partition_name := 'activity_events_' || to_char(month_start, 'YYYY_MM');
    CONTINUE WHEN to_regclass('part.' || partition_name) IS NOT NULL;

    LOCK TABLE part.activity_events_default IN ACCESS EXCLUSIVE MODE;
    -- Again under the lock: a second caller that waited here would otherwise fail on the table the first one made
    CONTINUE WHEN to_regclass('part.' || partition_name) IS NOT NULL;
    EXECUTE format('CREATE TABLE part.%I (LIKE public.activity_events INCLUDING ALL)', partition_name);
    EXECUTE format(
      'WITH moved AS (DELETE FROM part.activity_events_default WHERE occurred_at >= %L AND occurred_at < %L RETURNING *)
       INSERT INTO part.%I SELECT * FROM moved',
      month_start, month_end, partition_name
    );
    EXECUTE format(
      'ALTER TABLE public.activity_events ATTACH PARTITION part.%I FOR VALUES FROM (%L) TO (%L)',
      partition_name, month_start, month_end
    );
    created := created + 1;
  END LOOP;
  SELECT count(*) INTO stranded FROM part.activity_events_default;
  RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION public.ensure_activity_partitions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_activity_partitions(integer) TO gps_crm_app;
