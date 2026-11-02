// A working day on the seed of 1M clients (06-quality.md §6.1, 11-testing.md): 20 people at once, each doing what a
// manager does, with a pause between steps, and one export of about 100 000 objects in the middle of it. Only against
// a seed database (seed-scale.ts --prepare-run writes DATA), never staging. k6 reads DATA relative to this file, so
// both paths are absolute.
//   k6 run -e BASE_URL=http://127.0.0.1:3108 -e DATA=<absolute path of the file of --prepare-run> \
//     -e SUMMARY=<absolute path of the json> apps/api/scripts/k6/workday.js
import { check, sleep } from "k6";
import http from "k6/http";
import { Counter, Trend } from "k6/metrics";

const data = JSON.parse(open(__ENV.DATA));
const ORIGIN = __ENV.BASE_URL;
const API = `${ORIGIN}/api/v1`;
// The name the app gives its cookie in production (core/session/session.cookie.ts)
const COOKIE = __ENV.COOKIE_NAME || "__Host-session";
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || "10m";
const EXPORT_POLL_SECONDS = 3;
const EXPORT_WAIT_SECONDS = 600;

// The targets of 06-quality.md §6.1, p95 in milliseconds
const TARGETS = {
  first_page: 150,
  filtered: 300,
  count: 400,
  search: 300,
  card: 150,
  write: 200,
};

// What a person does in a day, by weight. Every request carries its operation and the target group it is held to.
const OPERATIONS = [
  ["clients_first_page", "first_page", 6, () => get("/subscribers?limit=50")],
  ["objects_first_page", "first_page", 6, () => get("/objects?limit=50")],
  ["clients_filtered", "filtered", 4, clientsFiltered],
  ["clients_next_page", "filtered", 2, clientsNextPage],
  ["objects_filtered", "filtered", 4, objectsFiltered],
  ["objects_by_manager", "filtered", 2, objectsByManager],
  ["clients_count", "count", 3, clientsCount],
  ["objects_count", "count", 3, objectsCount],
  ["objects_count_by_manager", "count", 1, objectsCountByManager],
  ["home", "count", 4, () => get("/home")],
  ["search_imei", "search", 4, () => get(`/search?q=${pick(data.objects).imei.slice(-6)}`)],
  ["search_phone", "search", 4, () => get(`/search?q=${pick(data.phones).slice(-7)}`)],
  ["search_name", "search", 4, () => get(`/search?q=${encodeURIComponent(pick(data.names))}`)],
  ["search_code", "search", 2, () => get(`/search?q=${pick(data.clients).code}`)],
  ["search_iccid", "search", 1, () => get(`/search?q=${pick(data.iccids).slice(-6)}`)],
  ["search_archive", "search", 1, () => get(`/search?q=${encodeURIComponent(pick(data.names))}&archived=true`)],
  ["client_card", "card", 8, () => get(`/subscribers/${pick(data.clients).id}`)],
  ["client_tabs", "card", 5, clientTabs],
  ["object_card", "card", 5, () => get(`/objects/${pick(data.objects).id}`)],
  ["object_history", "card", 2, () => get(`/objects/${pick(data.objects).id}/history`)],
  ["devices_list", "first_page", 2, () => get("/devices?limit=50")],
  ["sims_list", "first_page", 1, () => get("/sims?limit=50")],
  ["sensors_list", "first_page", 1, () => get("/sensors?limit=50")],
  ["devices_filtered", "filtered", 1, () => get(`/devices?status=removed&modelId=${pick(data.models)}&limit=50`)],
  ["devices_available", "first_page", 1, () => get("/devices/available?limit=20")],
  ["sims_available", "first_page", 1, () => get("/sims/available?limit=20")],
  ["sensors_available", "first_page", 1, () => get("/sensors/available?limit=20")],
  ["objects_archive", "first_page", 1, () => get("/objects?archived=true&limit=50")],
  ["devices_archive", "first_page", 1, () => get("/devices?archived=true&limit=50")],
  ["clients_archive", "first_page", 1, () => get("/subscribers?archived=true&limit=50")],
  ["contracts_expiring", "filtered", 1, () => get("/contracts?expiring=true&limit=50")],
  ["contracts_search", "search", 1, () => get(`/contracts?q=${encodeURIComponent(pick(data.names))}&limit=50`)],
  ["payers_search", "search", 1, () => get(`/payers?q=${encodeURIComponent(pick(data.names))}&limit=20`)],
  ["tariffs", "first_page", 1, () => get("/references/tariffs?limit=50")],
  ["journal", "first_page", 1, () => get("/activity?limit=50")],
  ["client_update", "write", 3, clientUpdate],
  ["object_update", "write", 2, objectUpdate],
  ["client_create", "write", 1, clientCreate],
];

const exportSeconds = new Trend("export_seconds");
const exportRows = new Trend("export_rows");
// An export refused, failed or still running at the end of the wait: its time would say nothing
const exportFailures = new Counter("export_failures");

const durationThreshold = (tag, ms) => [`http_req_duration{${tag}}`, [`p(95)<${ms}`]];

export const options = {
  scenarios: {
    workday: { executor: "constant-vus", exec: "workday", vus: VUS, duration: DURATION },
    // A minute in, so the export meets the full load of the day
    export: { executor: "per-vu-iterations", exec: "exportObjects", vus: 1, iterations: 1, startTime: "1m" },
  },
  thresholds: {
    // 06-quality.md §6.1: errors under load below 0.1 %
    http_req_failed: ["rate<0.001"],
    export_seconds: ["max<60"],
    export_failures: ["count==0"],
    // The export moved about as many rows as the seed holds for its filter, not a part of them
    export_rows: [`min>=${Math.floor(data.exportObjects.rows * 0.9)}`],
    ...Object.fromEntries(Object.entries(TARGETS).map(([group, ms]) => durationThreshold(`group:${group}`, ms))),
    // One line per operation in the summary: k6 keeps a sub-metric only for a threshold that names it
    ...Object.fromEntries(OPERATIONS.map(([op, group]) => durationThreshold(`op:${op}`, TARGETS[group]))),
  },
  summaryTrendStats: ["avg", "p(50)", "p(95)", "p(99)", "max", "count"],
};

const pick = (list) => list[Math.floor(Math.random() * list.length)];
// Each person edits clients of their own, so two people never race for one version of a record
const ownClient = () => {
  const own = data.clients.filter((_, index) => index % VUS === (__VU - 1) % VUS);
  return pick(own.length > 0 ? own : data.clients);
};

let current = { op: "", group: "" };

function request(method, path, body) {
  const session = data.sessions[(__VU - 1) % data.sessions.length];
  const response = http.request(method, `${API}${path}`, body === undefined ? null : JSON.stringify(body), {
    headers: { Cookie: `${COOKIE}=${session}`, Origin: ORIGIN, "Content-Type": "application/json" },
    tags: { op: current.op, group: current.group },
  });
  check(response, { [`${current.op} answered 2xx`]: (r) => r.status >= 200 && r.status < 300 });
  return response;
}

const get = (path) => request("GET", path);

function clientsFiltered() {
  const status = pick(["active", "suspended", "disconnected"]);
  const type = pick(["B2C", "B2B"]);
  get(`/subscribers?status=${status}&type=${type}&managerId=${pick(data.managers)}&sort=code&order=desc&limit=50`);
}

function clientsNextPage() {
  const first = get("/subscribers?sort=objects&order=desc&limit=50");
  const cursor = first.status === 200 ? first.json("nextCursor") : null;
  if (cursor) get(`/subscribers?sort=objects&order=desc&limit=50&cursor=${encodeURIComponent(cursor)}`);
}

function objectsFiltered() {
  const status = pick(["active", "suspended"]);
  get(
    `/objects?status=${status}&programId=${pick(data.programs)}&modelId=${pick(data.models)}&sort=connectedOn&limit=50`,
  );
}

function objectsByManager() {
  get(`/objects?managerId=${pick(data.managers)}&status=${pick(["suspended", "disconnected"])}&sort=name&limit=50`);
}

function clientsCount() {
  get(`/subscribers/count?status=active&type=${pick(["B2C", "B2B"])}&programId=${pick(data.programs)}`);
}

function objectsCount() {
  get(
    `/objects/count?status=${pick(["active", "suspended"])}&programId=${pick(data.programs)}&modelId=${pick(data.models)}`,
  );
}

function objectsCountByManager() {
  get(`/objects/count?managerId=${pick(data.managers)}&status=active`);
}

// What the card of a client loads next to it: the tabs a person opens
function clientTabs() {
  const { id } = pick(data.clients);
  get(`/subscribers/${id}/contacts`);
  get(`/subscribers/${id}/payers`);
  get(`/subscribers/${id}/contracts`);
  get(`/objects?subscriberId=${id}&limit=50`);
}

// A change carries the whole record with its version (D59)
function clientUpdate() {
  const card = get(`/subscribers/${ownClient().id}`);
  if (card.status !== 200) return;
  const { id, type, name, taxId, crmUrl, managerId, graceDays, discountKop, legacyCode, version } = card.json();
  const note = `Перевірка навантаження ${Date.now()}`;
  // A client without the link to the CRM asks for it on the next change (D36), as the form does
  const link = crmUrl ?? `https://crm.example.test/clients/${id}`;
  const body = { type, name, taxId, crmUrl: link, managerId, graceDays, discountKop, legacyCode, note, version };
  request("PATCH", `/subscribers/${id}`, body);
}

function objectUpdate() {
  const objectId = data.objects[(__VU - 1 + VUS * Math.floor(Math.random() * 10)) % data.objects.length].id;
  const card = get(`/objects/${objectId}`);
  if (card.status !== 200) return;
  const { name, version } = card.json();
  request("PATCH", `/objects/${objectId}`, { name, note: `Перевірка навантаження ${Date.now()}`, version });
}

const firstOfNextMonth = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
};

function clientCreate() {
  const tariff = pick(data.tariffs);
  const suffix = String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  request("POST", "/subscribers", {
    type: "B2C",
    name: `Клієнт навантаження ${suffix}`,
    crmUrl: `https://crm.example.test/load/${suffix}`,
    graceDays: 0,
    programId: tariff.programId,
    tariffId: tariff.id,
    tariffValidFrom: firstOfNextMonth(),
    contact: {
      fullName: "Контакт Навантаження",
      phone: `067${suffix}`,
      channel: "email",
      email: `load${suffix}@example.test`,
    },
    payer: { paymentMethod: "iban", detailsContact: `067${suffix}` },
  });
}

export function workday() {
  const total = OPERATIONS.reduce((sum, [, , weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  const [op, group, , run] = OPERATIONS.find(([, , weight]) => (roll -= weight) < 0) ?? OPERATIONS[0];
  current = { op, group };
  run();
  sleep(1 + Math.random() * 2);
}

// 06-quality.md §6.1: 100 000 rows in the background under 60 s. The person waits on the screen, polling as it does.
export function exportObjects() {
  current = { op: "export", group: "" };
  const { managerId, status } = data.exportObjects;
  const started = Date.now();
  const created = request("POST", "/exports", { entity: "objects", filters: { managerId, status } });
  if (created.status !== 202 && created.status !== 201) {
    exportFailures.add(1);
    return;
  }
  const exportId = created.json("id");
  for (let waited = 0; waited < EXPORT_WAIT_SECONDS; waited += EXPORT_POLL_SECONDS) {
    sleep(EXPORT_POLL_SECONDS);
    const job = get(`/exports/${exportId}`).json();
    if (job.status === "done") {
      exportSeconds.add((Date.now() - started) / 1000);
      exportRows.add(job.rowCount ?? 0);
      return;
    }
    if (job.status === "failed") break;
  }
  exportFailures.add(1);
}

export function handleSummary(summary) {
  const lines = Object.entries(summary.metrics)
    .filter(([name]) => name.startsWith("http_req_duration{") || name.startsWith("export_"))
    .map(([name, metric]) => {
      const { values } = metric;
      const verdict = metric.thresholds ? (Object.values(metric.thresholds).every((t) => t.ok) ? "ok" : "FAIL") : "";
      return `${name.padEnd(60)} p95=${(values["p(95)"] ?? 0).toFixed(1)} max=${(values.max ?? 0).toFixed(1)} n=${values.count ?? ""} ${verdict}`;
    });
  const failed = summary.metrics.http_req_failed.values;
  lines.push(
    `http_req_failed rate=${(failed.rate * 100).toFixed(3)} % (${failed.passes} of ${failed.passes + failed.fails})`,
  );
  return { stdout: `${lines.join("\n")}\n`, [__ENV.SUMMARY || "k6-summary.json"]: JSON.stringify(summary, null, 2) };
}
