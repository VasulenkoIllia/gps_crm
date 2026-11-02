-- Step 8 (06-quality.md §6.1, D86): Prisma sends a value of an enum as CAST($1::text AS <type>), and PostgreSQL reads
-- text into an enum through enum_in, which is only stable. The value then stays an expression at planning: the planner
-- estimates it, but keeps it out of the statistics of combinations (objects_filters_stats, D85), takes an empty
-- combination of status, program and model for thousands of objects and reads the table in the order of the list,
-- up to 4 s on the seed of 1M. An explicit cast through an immutable function becomes a constant at planning.
-- Immutable holds here: a label keeps its value while the type lives, a rename keeps it too, and nothing indexes these
-- casts. A migration that makes one of these types anew drops its cast and function first (D86).
-- For the enums the lists filter by. A wrong label fails as before, with 22P02.

CREATE FUNCTION public.subscriber_status_of_text(value text) RETURNS public.subscriber_status
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN pg_catalog.enum_in(value::cstring, 'public.subscriber_status'::regtype);
END $$;

CREATE CAST (text AS public.subscriber_status) WITH FUNCTION public.subscriber_status_of_text(text);

CREATE FUNCTION public.subscriber_type_of_text(value text) RETURNS public.subscriber_type
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN pg_catalog.enum_in(value::cstring, 'public.subscriber_type'::regtype);
END $$;

CREATE CAST (text AS public.subscriber_type) WITH FUNCTION public.subscriber_type_of_text(text);

CREATE FUNCTION public.object_status_of_text(value text) RETURNS public.object_status
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN pg_catalog.enum_in(value::cstring, 'public.object_status'::regtype);
END $$;

CREATE CAST (text AS public.object_status) WITH FUNCTION public.object_status_of_text(text);

CREATE FUNCTION public.device_status_of_text(value text) RETURNS public.device_status
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN pg_catalog.enum_in(value::cstring, 'public.device_status'::regtype);
END $$;

CREATE CAST (text AS public.device_status) WITH FUNCTION public.device_status_of_text(text);

CREATE FUNCTION public.sim_status_of_text(value text) RETURNS public.sim_status
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN pg_catalog.enum_in(value::cstring, 'public.sim_status'::regtype);
END $$;

CREATE CAST (text AS public.sim_status) WITH FUNCTION public.sim_status_of_text(text);
