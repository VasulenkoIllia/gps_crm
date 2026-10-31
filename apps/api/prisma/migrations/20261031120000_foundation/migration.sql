-- Objects outside the Prisma schema. Registered in src/core/db/schema-invariants.int.test.ts.
-- pg_stat_statements needs shared_preload_libraries on the server to collect anything (infra/compose*.yml).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Partitions live here so `prisma migrate diff` does not see them as extra tables.
CREATE SCHEMA IF NOT EXISTS part;
