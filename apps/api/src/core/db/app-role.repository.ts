import type { DbClient } from "./client.js";

export const APP_ROLE_NAME = "gps_crm_app";

// The migration creates the role without a password, and a password cannot be in a migration. It goes in as a query
// parameter and is spliced on the server inside DO: a statement of DO is not top level, so pg_stat_statements does not
// keep it, and log_parameter_max_length=0 keeps the parameter out of the log. The handler is there for the log as well:
// the CONTEXT of the original error would quote the statement, password included.
// CREATE ROLE here too: a migration already recorded in a restored dump does not run again on a new cluster.
export async function setAppRolePassword(db: DbClient, password: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('gps_crm.app_role_password', ${password}, true)`;
    await tx.$executeRaw`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gps_crm_app') THEN
          CREATE ROLE gps_crm_app NOLOGIN NOINHERIT;
        END IF;
        EXECUTE format(
          'ALTER ROLE gps_crm_app LOGIN PASSWORD %L',
          current_setting('gps_crm.app_role_password')
        );
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'could not set the password of the runtime role' USING ERRCODE = SQLSTATE;
      END
      $$
    `;
  });
}
