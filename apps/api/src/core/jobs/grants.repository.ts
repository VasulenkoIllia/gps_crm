import type { DbClient } from "../db/client.js";

// pg-boss makes its schema under the owner, and the running app works in it as the runtime role: DML and its functions,
// no DDL (06-quality.md §6.2.10). After every install, because a newer pg-boss can add tables. A dump keeps these grants.
export async function grantJobSchema(db: DbClient): Promise<void> {
  await db.$transaction([
    db.$executeRaw`GRANT USAGE ON SCHEMA pgboss TO gps_crm_app`,
    db.$executeRaw`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO gps_crm_app`,
    db.$executeRaw`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO gps_crm_app`,
  ]);
}
