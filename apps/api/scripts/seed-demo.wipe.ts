import type pg from "pg";

// What the demo seed empties and what it leaves (docs/deployment.md «Демо-дані на staging»). Every table of the schema
// is in one of the two lists: a table added later stops the seed until someone puts it in one.
const KEPT_TABLES = [
  "_prisma_migrations",
  "roles",
  "role_permissions",
  "user_permission_overrides",
  "users",
  "sessions",
  "auth_tokens",
  "two_factor_credentials",
  "two_factor_recovery_codes",
  "sign_in_throttle",
  "job_health",
  "job_events",
];

// In the order of the foreign keys, parents first: the seed writes them in this order. TRUNCATE takes them at once, so
// a table that keeps a link to one of them (KEPT_TABLES) makes it fail instead of losing rows by CASCADE.
export const DEMO_TABLES = [
  "programs",
  "monitoring_servers",
  "tariffs",
  "addons",
  "addon_prices",
  "addon_programs",
  "tracker_models",
  "sim_operators",
  "sim_plans",
  "contractors",
  "disconnect_reasons",
  "cost_prices",
  "subscriber_id_series",
  "subscriber_id_series_types",
  "subscribers",
  "subscriber_tariff_periods",
  "contacts",
  "payers",
  "payer_subscribers",
  "contracts",
  "files",
  "sims",
  "devices",
  "sensors",
  "objects",
  "object_status_periods",
  "object_service_terms",
  "object_addon_periods",
  "device_installations",
  "sim_installations",
  "sensor_installations",
  "archive_batches",
];
const WIPED_ONLY = ["export_jobs"];

// The journal keeps the lines about people and the system: sign-ins, invitations, 2FA, versions, runs of jobs.
// TRUNCATE would take them too, so the rest goes by DELETE, which the owner role may do.
const JOURNAL = "activity_events";
const KEPT_ACTION_PREFIXES = ["auth.", "two_factor.", "user.", "system.", "job."];
const KEPT_ACTIONS = `action LIKE ANY (ARRAY[${KEPT_ACTION_PREFIXES.map((prefix) => `'${prefix}%'`).join(", ")}])`;

// A line of the demo under one of these the next run would keep, and the demo would double
export const isKeptAction = (action: string) => KEPT_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));

export async function checkTables(db: pg.Client): Promise<void> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`,
  );
  const known = new Set([...KEPT_TABLES, ...DEMO_TABLES, ...WIPED_ONLY, JOURNAL]);
  const unknown = rows.map((row) => row.name).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`tables the seed does not know: ${unknown.join(", ")}; put each in seed-demo.wipe.ts first`);
  }
}

interface WipeCounts {
  tables: [string, number][];
  journalDeleted: number;
  journalKept: number;
}

export async function countWipe(db: pg.Client): Promise<WipeCounts> {
  const tables: [string, number][] = [];
  for (const table of [...DEMO_TABLES, ...WIPED_ONLY]) {
    const { rows } = await db.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}`);
    tables.push([table, Number(rows[0]?.count)]);
  }
  const { rows } = await db.query<{ deleted: string; kept: string }>(
    `SELECT count(*) FILTER (WHERE NOT (${KEPT_ACTIONS})) AS deleted, count(*) FILTER (WHERE ${KEPT_ACTIONS}) AS kept
     FROM ${JOURNAL}`,
  );
  return { tables, journalDeleted: Number(rows[0]?.deleted), journalKept: Number(rows[0]?.kept) };
}

// First in the caller's transaction: the count of clients and the keys of the files then see what TRUNCATE takes, and
// an upload of the app waits for the commit instead of slipping in between
export async function lockDemoTables(db: pg.Client): Promise<void> {
  await db.query(`LOCK TABLE ${[...DEMO_TABLES, ...WIPED_ONLY].join(", ")} IN ACCESS EXCLUSIVE MODE`);
}

// In the caller's transaction, after lockDemoTables. The keys of the files it removed come back: the files go from the
// storage only after the commit, so a failed run leaves the old data whole.
export async function wipe(db: pg.Client): Promise<string[]> {
  const { rows } = await db.query<{ key: string }>("SELECT key FROM files");
  await db.query(`TRUNCATE TABLE ${[...DEMO_TABLES, ...WIPED_ONLY].join(", ")}`);
  await db.query(`DELETE FROM ${JOURNAL} WHERE NOT (${KEPT_ACTIONS})`);
  return rows.map((row) => row.key);
}
