-- Step 8 (06-quality.md §6.1, D85): the filters of objects by the tracker's model and the client's manager, and the own
-- records of a manager, read columns of the object itself. Through a join, a page read objects in the order of the list
-- and looked up the tracker or the client of each: with a rare status or no match at all, every object of the table, up
-- to 9 s on the seed of 1M.
-- Plain statements in one transaction, which holds every read of objects until it ends: on staging the table is small
-- and production has none yet (D84). On a filled table this is three steps (docs/deployment.md), so the check below
-- stops it there.
DO $$
BEGIN
  IF (SELECT count(*) FROM "objects") > 100000 THEN
    RAISE EXCEPTION 'objects is filled: add the copies in steps (docs/deployment.md), not by this migration';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "objects" ADD COLUMN "model_id" UUID,
ADD COLUMN "manager_id" UUID;

-- The copies follow the tracker and the client in the same transaction, for every writer that keeps the triggers on.
-- FOR SHARE: a new object waits for a change of its tracker or client that is not committed yet and then reads it, as
-- that change, run before the object existed, never sees it. The functions run as the one who writes, with tables named
-- in full.
CREATE FUNCTION public.objects_copy_filters() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.model_id := (SELECT d.model_id FROM public.devices d WHERE d.id = NEW.current_device_id FOR SHARE);
  NEW.manager_id := (SELECT s.manager_id FROM public.subscribers s WHERE s.id = NEW.subscriber_id FOR SHARE);
  RETURN NEW;
END $$;

CREATE TRIGGER objects_copy_filters BEFORE INSERT OR UPDATE OF current_device_id, subscriber_id ON public.objects
FOR EACH ROW EXECUTE FUNCTION public.objects_copy_filters();

CREATE FUNCTION public.devices_copy_model() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.objects SET model_id = NEW.model_id WHERE current_device_id = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER devices_copy_model AFTER UPDATE OF model_id ON public.devices
FOR EACH ROW WHEN (OLD.model_id IS DISTINCT FROM NEW.model_id) EXECUTE FUNCTION public.devices_copy_model();

CREATE FUNCTION public.subscribers_copy_manager() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.objects SET manager_id = NEW.manager_id WHERE subscriber_id = NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER subscribers_copy_manager AFTER UPDATE OF manager_id ON public.subscribers
FOR EACH ROW WHEN (OLD.manager_id IS DISTINCT FROM NEW.manager_id) EXECUTE FUNCTION public.subscribers_copy_manager();

-- Objects already there, in one pass
UPDATE "objects" o SET
  "model_id" = (SELECT d."model_id" FROM "devices" d WHERE d."id" = o."current_device_id"),
  "manager_id" = (SELECT s."manager_id" FROM "subscribers" s WHERE s."id" = o."subscriber_id");

-- The filters lead and id closes them: with the model among the filters a capped count reads its 10 001 ids from the
-- index alone, in the order Prisma asks for, and a combination with no objects ends at once. The one by status and
-- program alone is a prefix of these.
DROP INDEX "objects_status_program_id_idx";

CREATE INDEX "objects_status_program_id_model_id_id_idx" ON "objects"("status", "program_id", "model_id", "id") WHERE "archived_at" IS NULL;

CREATE INDEX "objects_model_id_id_idx" ON "objects"("model_id", "id") WHERE "archived_at" IS NULL;

CREATE INDEX "objects_manager_id_status_id_idx" ON "objects"("manager_id", "status", "id") WHERE "archived_at" IS NULL;

CREATE INDEX "objects_manager_id_id_idx" ON "objects"("manager_id", "id") WHERE "archived_at" IS NULL;

CREATE INDEX "objects_manager_id_name_norm_id_idx" ON "objects"("manager_id", "name_norm", "id") WHERE "archived_at" IS NULL;

-- Which combinations of the filters exist: without it the planner takes them for independent, expects a page within the
-- first rows in the order of the list and reads the whole table for a combination with no objects. A restore from a
-- dump brings the definition without the numbers: RESTORE.md runs ANALYZE.
CREATE STATISTICS "objects_filters_stats" (mcv, dependencies) ON "status", "program_id", "model_id", "manager_id" FROM "objects";
ALTER STATISTICS "objects_filters_stats" SET STATISTICS 1000;
ANALYZE "objects";
