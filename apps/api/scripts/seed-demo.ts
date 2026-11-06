import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { todayKyiv } from "@gps_crm/shared";
import pg from "pg";
import { checkDemo, checkWritten } from "./seed-demo.checks.ts";
import { addClients } from "./seed-demo.clients.ts";
import {
  idClock,
  Journal,
  Moment,
  Rows,
  text,
  Timeline,
  type Cell,
  type Demo,
  type DemoUser,
} from "./seed-demo.model.ts";
import { addStock, makeEquipment } from "./seed-demo.equipment.ts";
import { addReferences } from "./seed-demo.references.ts";
import { checkTables, countWipe, DEMO_TABLES, isKeptAction, lockDemoTables, wipe } from "./seed-demo.wipe.ts";

// The demo of stage 1 for a presentation (docs/deployment.md «Демо-дані на staging»): empties every record but the
// users, their roles and sessions, then writes invented clients, objects, equipment, contracts with files, the archive
// and the journal. A second run does the same again, so the demo never doubles. The schema owner's connection only:
// the runtime role has no TRUNCATE and may not delete from the journal.
//   DEMO_DATABASE_URL=postgresql://<owner>:<password>@<host>:<port>/<db> node apps/api/scripts/seed-demo.ts \
//     --database <db> --files-dir <FILES_DIR of the app> [--dry-run]
// Plain Node runs it (no tsx): on staging the files go into a container of the app image, which has none.
const RUN_LOCK = 8_250_002;
// Production keeps a database of the same name: its host is what tells them apart
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "host.docker.internal"]);
const STAGING_HOST_MARK = "staging";
// A database with more clients than this is one people work in, whatever its name: refused
const REAL_DATA_CLIENTS = 200;
const JOURNAL_DAYS = 5;
const JOURNAL_END_GAP_MS = 2 * 60_000;
const MS_IN_DAY = 86_400_000;
const ID_CLOCK_LEAD_MS = 10 * 60_000;
const ROWS_PER_INSERT = 500;
const PARAMETERS_PER_INSERT = 60_000;
const LOCK_TIMEOUT = "5s";
// The tables stay locked for the app until the commit: a stuck statement must not hold them for long
const STATEMENT_TIMEOUT = "2min";
const IDLE_IN_TRANSACTION_TIMEOUT = "1min";
const CONNECT_TIMEOUT_MS = 10_000;
// The newest files of the database that --files-dir must hold: then it is the FILES_DIR of the app
const OLD_FILES_PROBED = 5;

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    database: { type: "string" },
    "files-dir": { type: "string" },
  },
});

function requireArgs(): { url: string; database: string; filesDir: string | null } {
  const url = process.env.DEMO_DATABASE_URL;
  if (!url) throw new Error("DEMO_DATABASE_URL is not set: the seed never takes DATABASE_URL");
  if (!args.database) throw new Error("--database names the database to write, as a check of where the URL leads");
  if (!args["dry-run"] && !args["files-dir"])
    throw new Error("--files-dir is the FILES_DIR of the app: the contract files go there");
  return { url, database: args.database, filesDir: args["files-dir"] ?? null };
}

function checkHost(url: string): void {
  const host = new URL(url).hostname;
  console.log(`host: ${host}`);
  if (!host.includes(STAGING_HOST_MARK) && !LOCAL_HOSTS.has(host)) {
    throw new Error(`host ${host || "(none)"}: the demo writes only the database of staging or one on this machine`);
  }
}

// The name the URL leads to, not the one it spells: a host in PGHOST or the query may lead elsewhere
async function checkReached(db: pg.Client, database: string): Promise<void> {
  const { rows } = await db.query<{ reached: string }>("SELECT current_database() AS reached");
  console.log(`database: ${rows[0]?.reached}`);
  if (rows[0]?.reached !== database) throw new Error(`connected to ${rows[0]?.reached}, not ${database}: refused`);
}

async function refuseRealData(db: pg.Client): Promise<void> {
  const { rows } = await db.query<{ count: string }>("SELECT count(*) AS count FROM subscribers");
  if (Number(rows[0]?.count) > REAL_DATA_CLIENTS) {
    throw new Error(`${rows[0]?.count} clients: more than ${REAL_DATA_CLIENTS} is real work, the demo refuses it`);
  }
}

async function readUsers(db: pg.Client): Promise<{ admin: DemoUser; managers: DemoUser[] }> {
  const { rows } = await db.query<{ id: string; full_name: string; role: string }>(
    `SELECT u.id, u.full_name, r.key AS role FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.status = 'active' ORDER BY u.created_at, u.id`,
  );
  // Any active user, as the form of a client offers them (subscribers.queries.ts listManagers)
  const managers = rows.map((row) => ({ id: row.id, fullName: row.full_name }));
  const admin = rows.find((row) => row.role === "admin");
  if (!admin) throw new Error("no active administrator: the references and the archive of the demo are theirs");
  return { admin: { id: admin.id, fullName: admin.full_name }, managers };
}

const monthName = (month: Date) =>
  `activity_events_${month.getUTCFullYear()}_${String(month.getUTCMonth() + 1).padStart(2, "0")}`;

// From the earliest of the last few days whose month has a partition: a line of a month without one would land in the
// default partition, which the job of partitions then has to move (activity.md П6)
async function journalStart(db: pg.Client, now: Date): Promise<number> {
  const wanted = now.getTime() - JOURNAL_DAYS * MS_IN_DAY;
  let start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const exists = async (month: Date) => {
    const { rows } = await db.query<{ has: boolean }>("SELECT to_regclass($1) IS NOT NULL AS has", [
      `part.${monthName(month)}`,
    ]);
    return rows[0]?.has === true;
  };
  if (!(await exists(new Date(start)))) throw new Error(`no partition ${monthName(new Date(start))} of the journal`);
  while (start > wanted) {
    const previous = new Date(start);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    if (!(await exists(previous))) break;
    start = previous.getTime();
  }
  return Math.max(start, wanted);
}

function buildDemo(users: Awaited<ReturnType<typeof readUsers>>, now: Date): Demo {
  const rows = new Rows();
  const timeline = new Timeline();
  const ids = idClock(now.getTime() - ID_CLOCK_LEAD_MS);
  const queue: (() => void)[] = [];
  const demo: Demo = {
    today: todayKyiv(now),
    ids,
    rows,
    timeline,
    journal: new Journal(rows, timeline, ids),
    ...users,
    files: [],
    later: (action) => queue.push(action),
  };
  const refs = addReferences(demo);
  const equipment = makeEquipment(demo, refs);
  addStock(demo, equipment);
  addClients(demo, refs, equipment);
  // A change of the story may add one of its own: it runs in turn
  for (let i = 0; i < queue.length; i++) queue[i]?.();
  const kept = demo.rows.of("activity_events").find((row) => isKeptAction(text(row, "action")));
  if (kept) throw new Error(`${text(kept, "action")}: the next run would keep this line of the demo`);
  return demo;
}

function valueOf(cell: Cell | undefined, timeline: Timeline): unknown {
  if (cell instanceof Moment) return timeline.dateOf(cell);
  if (typeof cell === "function") return cell();
  if (cell === undefined) throw new Error("a row of the demo lacks a column");
  return cell;
}

async function insertTable(db: pg.Client, table: string, demo: Demo): Promise<void> {
  const rows = demo.rows.of(table);
  const columns = Object.keys(rows[0] ?? {});
  if (rows.some((row) => Object.keys(row).length !== columns.length || columns.some((column) => !(column in row)))) {
    throw new Error(`${table}: the rows of the demo differ in their columns`);
  }
  const size = Math.min(ROWS_PER_INSERT, Math.floor(PARAMETERS_PER_INSERT / Math.max(columns.length, 1)));
  for (let from = 0; from < rows.length; from += size) {
    const values: unknown[] = [];
    const tuples = rows.slice(from, from + size).map((row) => {
      const cells = columns.map((column) => {
        values.push(valueOf(row[column], demo.timeline));
        return `$${values.length}`;
      });
      return `(${cells.join(", ")})`;
    });
    await db.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${tuples.join(", ")}`, values);
  }
}

// A key of the storage stays inside it, whatever a row says
function inside(dir: string, key: string): string {
  const root = resolve(dir);
  const target = resolve(root, key);
  if (!target.startsWith(root + sep)) throw new Error(`the file key ${key} leads out of ${dir}`);
  return target;
}

// The FILES_DIR of the app, not a path that only looks like it: the folder is there, and so are its newest files
async function checkFilesDir(db: pg.Client, dir: string): Promise<void> {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`--files-dir ${dir} is not a folder: give the FILES_DIR of the app`);
  const { rows } = await db.query<{ key: string }>("SELECT key FROM files ORDER BY created_at DESC LIMIT $1", [
    OLD_FILES_PROBED,
  ]);
  const found = await Promise.all(
    rows.map((row) =>
      stat(inside(dir, row.key)).then(
        () => true,
        () => false,
      ),
    ),
  );
  if (rows.length > 0 && !found.includes(true)) {
    throw new Error(
      `none of the ${rows.length} newest files of the database is in ${dir}: not the FILES_DIR of the app`,
    );
  }
}

// Each key goes on the list once its file is there: a failed run takes back only what it wrote
async function placeFiles(dir: string, files: Demo["files"], written: string[]): Promise<void> {
  for (const file of files) {
    const target = inside(dir, file.key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx" });
    written.push(file.key);
  }
}

interface Removal {
  removed: number;
  absent: number;
  failed: number;
}

async function removeFiles(dir: string, keys: string[]): Promise<Removal> {
  const result: Removal = { removed: 0, absent: 0, failed: 0 };
  for (const key of keys) {
    try {
      await rm(inside(dir, key));
      result.removed += 1;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        result.absent += 1;
      } else {
        result.failed += 1;
        console.error(`could not remove ${key}: ${String(error)}`);
      }
    }
  }
  return result;
}

function printPlan(demo: Demo): void {
  console.log("the demo writes:");
  for (const table of [...DEMO_TABLES, "activity_events"]) {
    console.log(`  ${table.padEnd(28)} ${String(demo.rows.of(table).length).padStart(5)}`);
  }
  console.log(`  files in the storage         ${String(demo.files.length).padStart(5)}`);
}

async function printCounts(db: pg.Client, title: string): Promise<void> {
  const counts = await countWipe(db);
  console.log(title);
  for (const [table, count] of counts.tables) console.log(`  ${table.padEnd(28)} ${String(count).padStart(5)}`);
  console.log(
    `  activity_events              ${String(counts.journalDeleted).padStart(5)}, keeps ${counts.journalKept} about people and the system`,
  );
}

// The transaction stays open for the caller: the old data goes and the demo comes. The keys of the old files come back.
async function fillDemo(db: pg.Client, demo: Demo): Promise<string[]> {
  await db.query("BEGIN");
  await lockDemoTables(db);
  await refuseRealData(db);
  const oldKeys = await wipe(db);
  const tables = [...DEMO_TABLES, "activity_events"];
  for (const table of tables) await insertTable(db, table, demo);
  await checkWritten(
    db,
    tables.map((table) => [table, demo.rows.of(table).length]),
  );
  await checkDemo(db);
  return oldKeys;
}

// The new files first, under keys no one has: a failed run takes them back and leaves the old data whole
async function write(db: pg.Client, demo: Demo, filesDir: string): Promise<void> {
  const written: string[] = [];
  let oldKeys: string[];
  try {
    await placeFiles(filesDir, demo.files, written);
    oldKeys = await fillDemo(db, demo);
  } catch (error) {
    // Its own failure must not hide the one that brought it
    await db
      .query("ROLLBACK")
      .catch((rollbackError: unknown) => console.error(`ROLLBACK failed: ${String(rollbackError)}`));
    const left = await removeFiles(filesDir, written);
    if (left.failed > 0) console.error(`${left.failed} new files of this run stay in ${filesDir}`);
    throw error;
  }
  // A COMMIT lost with the connection may have gone through: the new files stay, a dry run shows which data is there
  await db.query("COMMIT").catch((error: unknown) => {
    console.error("COMMIT failed: the new files stay; a --dry-run shows whether the demo is in the database");
    throw error;
  });
  const old = await removeFiles(filesDir, oldKeys);
  console.log(`written; old files removed: ${old.removed}, already absent: ${old.absent}, failed: ${old.failed}`);
  if (old.failed > 0) process.exitCode = 1;
}

const { url, database, filesDir } = requireArgs();
checkHost(url);
const db = new pg.Client({ connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
await db.connect();
try {
  await checkReached(db, database);
  await db.query(
    `SET lock_timeout = '${LOCK_TIMEOUT}'; SET statement_timeout = '${STATEMENT_TIMEOUT}';
     SET idle_in_transaction_session_timeout = '${IDLE_IN_TRANSACTION_TIMEOUT}'`,
  );
  // A writing run holds the lock before it reads anything: a second one stops here
  if (!args["dry-run"]) {
    const { rows } = await db.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [RUN_LOCK]);
    if (!rows[0]?.locked) throw new Error("another run of the demo seed is writing this database");
  }
  await checkTables(db);
  await refuseRealData(db);
  if (filesDir) await checkFilesDir(db, filesDir);
  const now = new Date();
  const users = await readUsers(db);
  console.log(`managers of the demo clients: ${users.managers.length} active users`);
  const demo = buildDemo(users, now);
  demo.timeline.spread(await journalStart(db, now), now.getTime() - JOURNAL_END_GAP_MS);
  await printCounts(db, "the seed empties (rows now):");
  printPlan(demo);
  if (args["dry-run"]) {
    console.log("dry run: nothing written");
  } else {
    if (!filesDir) throw new Error("--files-dir is required to write");
    await write(db, demo, filesDir);
    // TRUNCATE left the tables without statistics: the first lists of the demo would be planned blind
    await db.query(`ANALYZE ${[...DEMO_TABLES, "activity_events"].join(", ")}`);
    await printCounts(db, "now in the database:");
  }
} finally {
  await db.end().catch((error: unknown) => console.error(`closing the connection failed: ${String(error)}`));
}
