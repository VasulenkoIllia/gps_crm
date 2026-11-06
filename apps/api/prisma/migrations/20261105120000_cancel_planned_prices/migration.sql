-- A price or a cost typed in by mistake for a later date can be cancelled before it starts (references.md П3, D87).
-- The history of what was in force still never changes: UPDATE stays revoked, and a row that has started, by the date
-- of Kyiv as the app counts it, is refused here whoever deletes it. Tests empty these tables with TRUNCATE.
-- Not in schema.prisma, registered in schema-invariants.int.test.ts.

CREATE FUNCTION public.prices_keep_started() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.valid_from <= (now() AT TIME ZONE 'Europe/Kyiv')::date THEN
    RAISE EXCEPTION 'prices_keep_started: a price in force since % stays in the history', OLD.valid_from
      USING ERRCODE = 'check_violation', CONSTRAINT = 'prices_keep_started';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER addon_prices_keep_started BEFORE DELETE ON public.addon_prices
FOR EACH ROW EXECUTE FUNCTION public.prices_keep_started();

CREATE TRIGGER cost_prices_keep_started BEFORE DELETE ON public.cost_prices
FOR EACH ROW EXECUTE FUNCTION public.prices_keep_started();

GRANT DELETE ON "addon_prices", "cost_prices" TO gps_crm_app;
