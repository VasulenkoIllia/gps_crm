import { randomInt } from "node:crypto";
import { writeFileSync } from "node:fs";
import type pg from "pg";
import { generateToken } from "../src/core/crypto/tokens.js";
import type { Plan } from "./seed-scale.plan.js";
import { WORDS } from "./seed-scale.words.js";

// What the k6 run takes from the seed (apps/api/scripts/k6/workday.js): sessions of the seed users and real values to
// look for. The file stays in .tmp: the tokens open the seed database, nothing else.
const SAMPLE = 400;
const SESSION_HOURS = 48;
const MANAGERS = 16;
// The export of 06-quality.md §6.1 reads about this many rows at 1M clients
const EXPORT_ROWS_PER_MILLION = 100_000;

const sampleOf = (count: number) => Array.from({ length: SAMPLE }, () => randomInt(1, count + 1));

async function freshSessions(db: pg.Client): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>("SELECT id FROM seed.ref WHERE kind = 'user' ORDER BY n");
  const userIds = rows.map((row) => row.id);
  await db.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [userIds]);
  const tokens: string[] = [];
  for (const userId of userIds) {
    const { raw, hash } = generateToken();
    await db.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent)
       VALUES ($1, $2, now() + make_interval(hours => $3), '127.0.0.1', 'k6')`,
      [hash, userId, SESSION_HOURS],
    );
    tokens.push(raw);
  }
  return tokens;
}

async function column<T extends string>(db: pg.Client, text: string, values: unknown[] = []): Promise<T[]> {
  const { rows } = await db.query<{ value: T }>(text, values);
  return rows.map((row) => row.value);
}

async function refIds(db: pg.Client, kind: string): Promise<string[]> {
  return column(db, "SELECT id::text AS value FROM seed.ref WHERE kind = $1 ORDER BY n", [kind]);
}

// The manager and status whose live objects come nearest to the size of the export of the targets
async function exportFilter(db: pg.Client, plan: Plan) {
  const wanted = Math.round((EXPORT_ROWS_PER_MILLION * plan.clients) / 1_000_000);
  const { rows } = await db.query<{ manager_id: string; status: string; count: string }>(
    `SELECT s.manager_id, o.status, count(*) AS count FROM objects o JOIN subscribers s ON s.id = o.subscriber_id
     WHERE o.archived_at IS NULL GROUP BY 1, 2`,
  );
  if (rows.length === 0) throw new Error("no live objects: finish the seed before --prepare-run");
  const best = rows.reduce((a, b) =>
    Math.abs(Number(a.count) - wanted) <= Math.abs(Number(b.count) - wanted) ? a : b,
  );
  return { managerId: best.manager_id, status: best.status, rows: Number(best.count) };
}

// Parts of names from three letters up: a search by these meets thousands of rows, as a real one does
function nameQueries(): string[] {
  const starts = (words: string[], length: number) => words.map((word) => word.slice(0, length));
  return [
    ...starts(WORDS.surnames.norm.slice(0, 10), 6),
    ...starts(WORDS.companyFirst.norm.slice(0, 10), 4),
    ...starts(WORDS.objectKinds.norm.slice(0, 5), 5),
    `${WORDS.surnames.norm[0]} ${WORDS.firstNames.norm[0]}`,
    `${WORDS.companyPrefixes.norm[0]} ${WORDS.companyFirst.norm[0]}`,
  ];
}

export async function prepareRun(db: pg.Client, plan: Plan, path: string): Promise<void> {
  const sessions = await freshSessions(db);
  const clients = await db.query<{ id: string; code: string }>(
    `SELECT s.id, s.code::text FROM seed.client c JOIN subscribers s ON s.id = c.id
     WHERE c.n = ANY($1::int[]) AND s.archived_at IS NULL`,
    [sampleOf(plan.clients)],
  );
  // workday.js changes them, and a disconnected object takes no change (objects.md)
  const objects = await db.query<{ id: string; imei: string }>(
    `SELECT o.id, d.imei FROM seed.object so JOIN objects o ON o.id = so.id JOIN devices d ON d.id = o.current_device_id
     WHERE so.n = ANY($1::int[]) AND o.archived_at IS NULL AND o.status <> 'disconnected'`,
    [sampleOf(plan.objects)],
  );
  const phones = await column(
    db,
    `SELECT c.phone AS value FROM seed.client sc JOIN contacts c ON c.subscriber_id = sc.id
     WHERE sc.n = ANY($1::int[]) AND c.is_primary AND c.archived_at IS NULL`,
    [sampleOf(plan.clients)],
  );
  const iccids = await column(
    db,
    `SELECT s.iccid AS value FROM seed.sim ss JOIN sims s ON s.id = ss.id WHERE ss.n = ANY($1::int[])`,
    [sampleOf(plan.sims)],
  );
  const tariffs = await db.query<{ id: string; program_id: string }>(
    "SELECT id, program_id FROM tariffs WHERE billing_model = 'month' ORDER BY name_norm, id",
  );
  const users = await refIds(db, "user");
  const data = {
    sessions,
    clients: clients.rows.map((row) => ({ id: row.id, code: row.code })),
    objects: objects.rows.map((row) => ({ id: row.id, imei: row.imei })),
    phones,
    iccids,
    names: nameQueries(),
    managers: users.slice(0, MANAGERS),
    programs: await refIds(db, "program"),
    servers: await refIds(db, "server"),
    tariffs: tariffs.rows.map((row) => ({ id: row.id, programId: row.program_id })),
    models: await refIds(db, "model"),
    operators: await refIds(db, "operator"),
    contractors: await refIds(db, "contractor"),
    addons: await refIds(db, "addon"),
    exportObjects: await exportFilter(db, plan),
  };
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 });
}
