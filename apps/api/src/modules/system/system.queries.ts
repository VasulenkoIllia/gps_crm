import type { DbOrTx } from "../../core/db/client.js";

const LARGEST_TABLES = 10;
const DEPLOYMENTS_SHOWN = 5;
const JOB_RUNS_SHOWN = 10;

export interface DatabaseSize {
  sizeBytes: number;
  tables: { name: string; sizeBytes: number }[];
}

// A partition counts toward its table: the journal is one line on the screen, not one per month
export async function readDatabaseSize(db: DbOrTx): Promise<DatabaseSize> {
  const [total] = await db.$queryRaw<{ sizeBytes: bigint }[]>`
    SELECT pg_database_size(current_database()) AS "sizeBytes"
  `;
  const tables = await db.$queryRaw<{ name: string; sizeBytes: bigint }[]>`
    SELECT COALESCE(parent.relname, c.relname) AS name, sum(pg_total_relation_size(c.oid))::bigint AS "sizeBytes"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_inherits i ON i.inhrelid = c.oid
    LEFT JOIN pg_class parent ON parent.oid = i.inhparent
    WHERE c.relkind = 'r' AND n.nspname IN ('public', 'part', 'pgboss')
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT ${LARGEST_TABLES}
  `;
  return {
    sizeBytes: Number(total?.sizeBytes ?? 0),
    tables: tables.map((table) => ({ name: table.name, sizeBytes: Number(table.sizeBytes) })),
  };
}

export interface DeploymentRow {
  version: string;
  previousVersion: string | null;
  deployedAt: string;
}

export async function readDeployments(db: DbOrTx): Promise<DeploymentRow[]> {
  const rows = await db.activityEvent.findMany({
    where: { action: "system.deployed" },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: DEPLOYMENTS_SHOWN,
    select: { occurredAt: true, changes: true },
  });
  return rows.map((row) => {
    const details = row.changes as { version?: string; previousVersion?: string | null } | null;
    return {
      version: details?.version ?? "",
      previousVersion: details?.previousVersion ?? null,
      deployedAt: row.occurredAt.toISOString(),
    };
  });
}

export function readJobHealth(db: DbOrTx) {
  return db.jobHealth.findMany();
}

export interface JobRunRow {
  id: string;
  jobName: string;
  trigger: "schedule" | "manual";
  isSuccess: boolean;
  startedAt: Date;
  finishedAt: Date;
  skippedItems: number;
  error: string | null;
}

// One query for every job, so the page costs the same however many there are
export function readRecentJobRuns(db: DbOrTx): Promise<JobRunRow[]> {
  return db.$queryRaw<JobRunRow[]>`
    SELECT run.id::text AS id, name.job_name AS "jobName", run.trigger, run.is_success AS "isSuccess",
      run.started_at AS "startedAt", run.finished_at AS "finishedAt", run.skipped_items AS "skippedItems", run.error
    FROM (SELECT DISTINCT job_name FROM job_events) name
    CROSS JOIN LATERAL (
      SELECT * FROM job_events WHERE job_name = name.job_name ORDER BY id DESC LIMIT ${JOB_RUNS_SHOWN}
    ) run
    ORDER BY run.id DESC
  `;
}
