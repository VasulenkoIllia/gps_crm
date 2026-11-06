-- D91: the lists of clients and objects read the tariff of the newest version off the row (D60, D70), and now also the
-- day it takes over, so a list can mark a tariff that is not in force yet. The day is where the tariff of the newest
-- live version began: a version that only repeats it (a new payer under the same tariff) does not move it
-- (`valueSince` in packages/shared/src/periods.ts, the same rule).
-- Plain statements in one transaction, which holds every read and write of both tables until it ends: on staging they
-- are small and production has none yet. On a filled table this is steps (docs/deployment.md), so the check below stops it there.
DO $$
BEGIN
  IF (SELECT count(*) FROM "subscribers") > 100000 OR (SELECT count(*) FROM "objects") > 100000 THEN
    RAISE EXCEPTION 'subscribers or objects is filled: add tariff_from in steps (docs/deployment.md), not by this migration';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "subscribers" ADD COLUMN "tariff_from" DATE;

-- AlterTable
ALTER TABLE "objects" ADD COLUMN "tariff_from" DATE;

-- A live period is one that is in force on some day: one replaced before it began stays as [X, X) (D61)
UPDATE "subscribers" s SET "tariff_from" = (
  SELECT min(p."valid_from") FROM "subscriber_tariff_periods" p
  WHERE p."subscriber_id" = s."id" AND (p."valid_to" IS NULL OR p."valid_to" > p."valid_from")
    AND p."valid_from" > coalesce((
      SELECT max(d."valid_from") FROM "subscriber_tariff_periods" d
      WHERE d."subscriber_id" = s."id" AND (d."valid_to" IS NULL OR d."valid_to" > d."valid_from")
        AND d."tariff_id" <> s."tariff_id"
    ), '-infinity'::date)
);

-- The tariff of an object is its own one, or the client's when the terms name none. Here only the day of that choice:
-- for the client's tariff the list takes the later of it and the client's own day when it reads (objects.queries.ts)
UPDATE "objects" o SET "tariff_from" = (
  SELECT min(t."valid_from") FROM "object_service_terms" t
  WHERE t."object_id" = o."id" AND (t."valid_to" IS NULL OR t."valid_to" > t."valid_from")
    AND t."valid_from" > coalesce((
      SELECT max(d."valid_from") FROM "object_service_terms" d
      WHERE d."object_id" = o."id" AND (d."valid_to" IS NULL OR d."valid_to" > d."valid_from")
        AND d."own_tariff_id" IS DISTINCT FROM (CASE WHEN o."has_own_tariff" THEN o."tariff_id" END)
    ), '-infinity'::date)
);

-- A row whose tariff is not in its own history stops the migration here, as a broken mirror should
ALTER TABLE "subscribers" ALTER COLUMN "tariff_from" SET NOT NULL;

ALTER TABLE "objects" ALTER COLUMN "tariff_from" SET NOT NULL;
