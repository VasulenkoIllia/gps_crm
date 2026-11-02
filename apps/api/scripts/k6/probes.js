// The queries 06-quality.md §6.1 asks to check on the seed of 1M one by one («Що перевірити на цьому сиді окремо»,
// D69): one person, each request in turn, several rounds, so a slow plan shows without the load of workday.js. The same
// DATA as workday.js, absolute paths. SESSION picks the person by the order of the seed users (0 is an admin); a run
// with a manager whose role reads only own records shows the plans of that scope.
//   k6 run -e BASE_URL=http://127.0.0.1:3108 -e DATA=<absolute path> -e SUMMARY=<absolute path> apps/api/scripts/k6/probes.js
import { check } from "k6";
import http from "k6/http";

const data = JSON.parse(open(__ENV.DATA));
const ORIGIN = __ENV.BASE_URL;
const API = `${ORIGIN}/api/v1`;
const COOKIE = __ENV.COOKIE_NAME || "__Host-session";
const ROUNDS = Number(__ENV.ROUNDS || 10);
const SESSION = data.sessions[Number(__ENV.SESSION || 0)];
// The search of the header holds every group within 2 s (search-exports.md П3); the rest by their group of §6.1
const LIMIT_MS = { first_page: 150, filtered: 300, count: 400, search: 300, card: 150 };

const enc = encodeURIComponent;
const [name3, name3b] = ["ков", "оле"];
const surname = data.names[0];
const object = data.objects[0];
const model = data.models[1];
const manager = data.managers[3];

const PROBES = [
  // Step 5: the free equipment, NOT EXISTS over the open installations
  ["sensors_available", "first_page", "/sensors/available?limit=20"],
  ["sensors_available_q", "first_page", `/sensors/available?q=${enc("дут-01")}&limit=20`],
  ["devices_available", "first_page", "/devices/available?limit=20"],
  ["sims_available", "first_page", "/sims/available?limit=20"],
  // Step 5: two-step searches with take 200 and no order, on frequent matches
  ["clients_q_phone4", "filtered", `/subscribers?q=${data.phones[0].slice(-4)}&limit=50`],
  ["clients_q_phone7", "filtered", `/subscribers?q=${data.phones[0].slice(-7)}&limit=50`],
  ["clients_q_imei6", "filtered", `/subscribers?q=${object.imei.slice(-6)}&limit=50`],
  ["objects_q_imei6", "filtered", `/objects?q=${object.imei.slice(-6)}&limit=50`],
  ["objects_q_imei4", "filtered", `/objects?q=${object.imei.slice(-4)}&limit=50`],
  // D69: a part of a name with ORDER BY ... LIMIT in clients, payers and contracts
  ["clients_q_name3", "filtered", `/subscribers?q=${enc(name3)}&limit=50`],
  ["clients_q_name3_by_code", "filtered", `/subscribers?q=${enc(name3)}&sort=code&order=desc&limit=50`],
  ["clients_q_surname", "filtered", `/subscribers?q=${enc(surname)}&limit=50`],
  ["objects_q_name", "filtered", `/objects?q=${enc("вант")}&limit=50`],
  ["payers_q_name3", "filtered", `/payers?q=${enc(name3)}&limit=20`],
  ["contracts_q_name3", "filtered", `/contracts?q=${enc(name3)}&limit=50`],
  ["contracts_q_number", "filtered", `/contracts?q=${enc("д-000")}&limit=50`],
  // D69: the count of clients on every tariff
  ["tariffs", "first_page", "/references/tariffs?limit=50"],
  // Step 5: the archive, which the partial indexes of the live records leave out
  ["objects_archive", "first_page", "/objects?archived=true&limit=50"],
  ["objects_archive_q", "filtered", `/objects?archived=true&q=${enc("вант")}&limit=50`],
  ["devices_archive", "first_page", "/devices?archived=true&limit=50"],
  ["sims_archive", "first_page", "/sims?archived=true&limit=50"],
  ["sensors_archive", "first_page", "/sensors?archived=true&limit=50"],
  ["clients_archive", "first_page", "/subscribers?archived=true&limit=50"],
  ["clients_archive_q", "filtered", `/subscribers?archived=true&q=${enc(name3)}&limit=50`],
  // Step 5: the filters of objects through the tracker's model and the client's manager
  ["objects_by_model", "filtered", `/objects?modelId=${model}&limit=50`],
  ["objects_by_model_sorted", "filtered", `/objects?modelId=${model}&status=active&sort=name&limit=50`],
  ["objects_by_manager", "filtered", `/objects?managerId=${manager}&limit=50`],
  ["objects_by_manager_sorted", "filtered", `/objects?managerId=${manager}&sort=name&limit=50`],
  ["objects_count_by_model", "count", `/objects/count?modelId=${model}`],
  ["objects_count_by_manager", "count", `/objects/count?managerId=${manager}`],
  // D86: a combination of status, program and model with few objects or none, in the order of the date
  [
    "objects_rare_by_date",
    "filtered",
    `/objects?status=suspended&programId=${data.programs[0]}&modelId=${model}&sort=connectedOn&limit=50`,
  ],
  // The list sends its search to the count as well
  ["clients_count_q_name3", "count", `/subscribers/count?q=${enc(name3)}`],
  ["clients_count_q_surname", "count", `/subscribers/count?q=${enc(surname)}`],
  ["objects_count_q_name", "count", `/objects/count?q=${enc("вант")}`],
  ["objects_count_q_imei6", "count", `/objects/count?q=${object.imei.slice(-6)}`],
  // Step 6: the search of the header, every group together; contacts by three letters, the archive
  ["search_imei6", "search", `/search?q=${object.imei.slice(-6)}`],
  ["search_phone7", "search", `/search?q=${data.phones[1].slice(-7)}`],
  ["search_phone4", "search", `/search?q=${data.phones[1].slice(-4)}`],
  ["search_code", "search", `/search?q=${data.clients[0].code}`],
  ["search_name3", "search", `/search?q=${enc(name3b)}`],
  ["search_surname", "search", `/search?q=${enc(surname)}`],
  ["search_name3_archive", "search", `/search?q=${enc(name3b)}&archived=true`],
  ["search_imei6_archive", "search", `/search?q=${object.imei.slice(-6)}&archived=true`],
  // Step 6: the start page, «Мої останні записи» by the author
  ["home", "count", "/home"],
];

export const options = {
  scenarios: { probes: { executor: "per-vu-iterations", vus: 1, iterations: ROUNDS, maxDuration: "30m" } },
  thresholds: {
    // A fast refusal is no answer: every probe answers 200
    checks: ["rate==1"],
    ...Object.fromEntries(PROBES.map(([op, group]) => [`http_req_duration{op:${op}}`, [`p(95)<${LIMIT_MS[group]}`]])),
  },
  summaryTrendStats: ["avg", "p(50)", "p(95)", "max", "count"],
};

export default function probes() {
  for (const [op, group, path] of PROBES) {
    const response = http.get(`${API}${path}`, {
      headers: { Cookie: `${COOKIE}=${SESSION}`, Origin: ORIGIN },
      tags: { op, group },
    });
    check(response, { [`${op} answered 200`]: (r) => r.status === 200 });
  }
}

export function handleSummary(summary) {
  const failedChecks = new Set((summary.root_group?.checks ?? []).filter((c) => c.fails > 0).map((c) => c.name));
  const lines = PROBES.map(([op]) => {
    const metric = summary.metrics[`http_req_duration{op:${op}}`];
    const values = metric?.values ?? {};
    const isAnswered = !failedChecks.has(`${op} answered 200`);
    const isOk = metric && isAnswered ? Object.values(metric.thresholds ?? {}).every((t) => t.ok) : false;
    return `${op.padEnd(28)} p50=${(values["p(50)"] ?? 0).toFixed(1)} p95=${(values["p(95)"] ?? 0).toFixed(1)} max=${(values.max ?? 0).toFixed(1)} ${isOk ? "ok" : "FAIL"}`;
  });
  return { stdout: `${lines.join("\n")}\n`, [__ENV.SUMMARY || "k6-probes.json"]: JSON.stringify(summary, null, 2) };
}
