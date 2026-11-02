import { parseArgs } from "node:util";
import { isValidEdrpou, isValidIpn, normalizeName } from "@gps_crm/shared";
import pg from "pg";
import { CLIENT_STEPS, TAX_ID_FUNCTIONS } from "./seed-scale.clients.js";
import { FINISH_STEPS } from "./seed-scale.finish.js";
import { OBJECT_STEPS } from "./seed-scale.objects.js";
import { DEFAULT_CLIENTS, planFor, SEED_CODE_FROM, type Plan, type Step } from "./seed-scale.plan.js";
import { prepareRun } from "./seed-scale.prepare.js";

// The seed of 1M clients for the load test (06-quality.md §6.1, 11-testing.md). Locally or on a database of its own,
// never on staging: it takes only a database whose name ends in _scale, and refuses one with real five-digit clients.
//   SCALE_DATABASE_URL=postgresql://<owner>@127.0.0.1:<port>/gps_crm_scale npm run seed:scale -w @gps_crm/api -- --dry-run
// The database gets the migrations and `setup` first, as on a deploy (README «Перевірка масштабу»).
const SCALE_SUFFIX = "_scale";
const STEPS: Step[] = [...CLIENT_STEPS, ...OBJECT_STEPS, ...FINISH_STEPS];
const NAME_SAMPLE = 2_000;
// The key of pg_try_advisory_lock for a run of this script
const RUN_LOCK = 8_250_001;

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    clients: { type: "string", default: String(DEFAULT_CLIENTS) },
    "prepare-run": { type: "string" },
  },
});

function databaseName(url: string | undefined): string {
  if (!url) throw new Error("SCALE_DATABASE_URL is not set: the seed never takes DATABASE_URL");
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name) || !name.endsWith(SCALE_SUFFIX)) {
    throw new Error(`SCALE_DATABASE_URL must name a *${SCALE_SUFFIX} database, not ${name}`);
  }
  return name;
}

const SEED_SCHEMA = `
  CREATE SCHEMA IF NOT EXISTS seed;
  CREATE TABLE IF NOT EXISTS seed.meta (clients int NOT NULL);
  CREATE TABLE IF NOT EXISTS seed.progress (step text PRIMARY KEY, seconds numeric NOT NULL, done_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE IF NOT EXISTS seed.ref (kind text, n int, id uuid NOT NULL, parent_id uuid, server_id uuid, PRIMARY KEY (kind, n));
  CREATE TABLE IF NOT EXISTS seed.client (n int PRIMARY KEY, id uuid NOT NULL, type subscriber_type NOT NULL,
    archived boolean NOT NULL, batch_id uuid);
  CREATE TABLE IF NOT EXISTS seed.object (n int PRIMARY KEY, id uuid NOT NULL, client_n int NOT NULL,
    status object_status NOT NULL, archived boolean NOT NULL, batch_id uuid);
  CREATE TABLE IF NOT EXISTS seed.device (n int PRIMARY KEY, id uuid NOT NULL);
  CREATE TABLE IF NOT EXISTS seed.sim (n int PRIMARY KEY, id uuid NOT NULL);
  CREATE TABLE IF NOT EXISTS seed.payer (n int PRIMARY KEY, id uuid NOT NULL, client_n int NOT NULL,
    archived boolean NOT NULL, batch_id uuid);
  ${TAX_ID_FUNCTIONS}
`;

// The URL named a *_scale database; a host in its query or PGHOST may still lead to another server's database
async function checkReached(db: pg.Client, name: string): Promise<void> {
  const { rows } = await db.query<{ reached: string }>("SELECT current_database() AS reached");
  if (rows[0]?.reached !== name) throw new Error(`connected to ${rows[0]?.reached}, not ${name}: refused`);
}

// Two runs would write the same chunks. Held by the connection until the run ends.
async function lockRun(db: pg.Client): Promise<void> {
  const { rows } = await db.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [RUN_LOCK]);
  if (!rows[0]?.locked) throw new Error("another run of the seed is writing this database");
}

// A database with clients outside the seed series is somebody's real one, whatever its name
async function refuseRealData(db: pg.Client): Promise<void> {
  const { rows } = await db.query<{ count: string }>(
    "SELECT count(*) AS count FROM (SELECT 1 FROM subscribers WHERE code < $1 LIMIT 1) real_ones",
    [SEED_CODE_FROM],
  );
  if (Number(rows[0]?.count) > 0) throw new Error("the database holds clients outside the seed series: refused");
}

// The seed goes on where it stopped only with the plan it started
async function pinPlan(db: pg.Client, plan: Plan, isDryRun: boolean): Promise<void> {
  const { rows } = await db.query<{ clients: number }>("SELECT clients FROM seed.meta");
  const pinned = rows[0]?.clients;
  if (pinned === undefined) {
    if (!isDryRun) await db.query("INSERT INTO seed.meta (clients) VALUES ($1)", [plan.clients]);
  } else if (pinned !== plan.clients) {
    throw new Error(`this database was seeded for ${pinned} clients, not ${plan.clients}`);
  }
}

function chunksOf(step: Step, plan: Plan): [number, number][] {
  const total = step.rows(plan);
  const size = step.chunk ?? total;
  const chunks: [number, number][] = [];
  for (let from = 1; from <= total; from += size) chunks.push([from, Math.min(from + size - 1, total)]);
  return chunks;
}

const keyOf = (step: Step, from: number) => (step.chunk ? `${step.name}:${from}` : step.name);

async function runChunk(db: pg.Client, step: Step, plan: Plan, [from, to]: [number, number]): Promise<number> {
  const started = performance.now();
  const statements = step.sql(plan, from, to);
  const secondsSince = () => (performance.now() - started) / 1_000;
  const markDone = () =>
    db.query("INSERT INTO seed.progress (step, seconds) VALUES ($1, $2)", [keyOf(step, from), secondsSince()]);
  if (step.isOutsideTransaction) {
    for (const { text, values } of statements) await db.query(text, values);
    await markDone();
  } else {
    await db.query("BEGIN");
    try {
      for (const { text, values } of statements) await db.query(text, values);
      // With the rows: a stop between the two would repeat a chunk that is there, on keys that are taken
      await markDone();
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }
  return secondsSince();
}

async function hasSeedSchema(db: pg.Client): Promise<boolean> {
  const { rows } = await db.query<{ has: boolean }>("SELECT to_regclass('seed.meta') IS NOT NULL AS has");
  return rows[0]?.has === true;
}

async function doneKeys(db: pg.Client): Promise<Set<string>> {
  if (!(await hasSeedSchema(db))) return new Set();
  const { rows } = await db.query<{ step: string }>("SELECT step FROM seed.progress");
  return new Set(rows.map((row) => row.step));
}

async function printPlan(db: pg.Client, plan: Plan, name: string): Promise<void> {
  const done = await doneKeys(db);
  const { rows } = await db.query<{ size: string }>(
    "SELECT pg_size_pretty(pg_database_size(current_database())) AS size",
  );
  console.log(`database ${name}, now ${rows[0]?.size}; plan for ${plan.clients} clients:`);
  for (const step of STEPS) {
    const chunks = chunksOf(step, plan);
    const left = chunks.filter(([from]) => !done.has(keyOf(step, from))).length;
    console.log(
      `  ${step.name.padEnd(12)} ${String(step.rows(plan)).padStart(10)} rows, ${left} of ${chunks.length} chunks left`,
    );
  }
}

// The names are made in SQL from normalized words: a sample proves the result is what the app would store
async function checkNames(db: pg.Client): Promise<void> {
  const tables = [
    ["subscribers", "name", "name_norm"],
    ["payers", "name", "name_norm"],
    ["contacts", "full_name", "full_name_norm"],
    ["objects", "name", "name_norm"],
  ] as const;
  for (const [table, shown, norm] of tables) {
    const { rows } = await db.query<{ shown: string; norm: string }>(
      `SELECT ${shown} AS shown, ${norm} AS norm FROM ${table} TABLESAMPLE BERNOULLI (1) LIMIT ${NAME_SAMPLE}`,
    );
    if (rows.length === 0) throw new Error(`${table}: the sample of names is empty`);
    const wrong = rows.find((row) => normalizeName(row.shown) !== row.norm);
    if (wrong) throw new Error(`${table}: «${wrong.norm}» is not the norm of «${wrong.shown}»`);
  }
}

// The check digits are made in SQL as well, and a form of the app refuses a wrong one on the next change of the record
async function checkTaxIds(db: pg.Client): Promise<void> {
  for (const table of ["subscribers", "payers"]) {
    const { rows } = await db.query<{ code: string }>(
      `SELECT tax_id AS code FROM ${table} TABLESAMPLE BERNOULLI (1) WHERE tax_id IS NOT NULL LIMIT ${NAME_SAMPLE}`,
    );
    if (rows.length === 0) throw new Error(`${table}: the sample of tax ids is empty`);
    const wrong = rows.find(({ code }) => !(code.length === 10 ? isValidIpn(code) : isValidEdrpou(code)));
    if (wrong) throw new Error(`${table}: tax id ${wrong.code} has a wrong check digit`);
  }
}

async function seed(db: pg.Client, plan: Plan): Promise<void> {
  const done = await doneKeys(db);
  for (const step of STEPS) {
    const chunks = chunksOf(step, plan);
    for (const chunk of chunks) {
      if (done.has(keyOf(step, chunk[0]))) continue;
      const seconds = await runChunk(db, step, plan, chunk);
      console.log(`${step.name} ${chunk[1]}/${step.rows(plan)}: ${seconds.toFixed(1)} s`);
    }
  }
  await checkNames(db);
  await checkTaxIds(db);
}

const name = databaseName(process.env.SCALE_DATABASE_URL);
const plan = planFor(Number(args.clients));
const db = new pg.Client({ connectionString: process.env.SCALE_DATABASE_URL });
await db.connect();
try {
  console.log(`database: ${name}`);
  await checkReached(db, name);
  await refuseRealData(db);
  if (args["dry-run"]) {
    // Writes nothing: a fresh database has no seed schema yet, and its plan is all left to do
    if (await hasSeedSchema(db)) await pinPlan(db, plan, true);
    await printPlan(db, plan, name);
  } else {
    // A throwaway database: a crash loses at most the last chunk, which the next run repeats
    await lockRun(db);
    await db.query("SET synchronous_commit = off");
    await db.query(SEED_SCHEMA);
    await pinPlan(db, plan, false);
    if (args["prepare-run"]) {
      await prepareRun(db, plan, args["prepare-run"]);
      console.log(`sessions and samples for k6: ${args["prepare-run"]}`);
    } else {
      await seed(db, plan);
      await printPlan(db, plan, name);
    }
  }
} finally {
  await db.end();
}
