import pg from "pg";

const E2E_SUFFIX = "_e2e";

// Drops a database, so it takes only one named *_e2e: a tunnel to a server looks exactly like a local port
const url = new URL(process.env.E2E_DATABASE_URL ?? "");
const name = url.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(name) || !name.endsWith(E2E_SUFFIX)) {
  throw new Error(`E2E_DATABASE_URL must name a *${E2E_SUFFIX} database, not ${name}`);
}

url.pathname = "/postgres";
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${name}`);
} finally {
  await client.end();
}
