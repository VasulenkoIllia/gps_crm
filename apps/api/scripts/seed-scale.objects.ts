import { Sql, sql, type Plan, type Step } from "./seed-scale.plan.js";
import { PHONE_CODES, WORDS, type WordList } from "./seed-scale.words.js";

const CHUNK = 250_000;
// Days after connecting: a suspended object stopped at +60, a disconnected one at +90, a replaced tracker came off at +30
const SUSPENDED_AFTER = 60;
const DISCONNECTED_AFTER = 90;
const REPLACED_AFTER = 30;

// Past the objects, the trackers of the stock: these shares of all clients are «removed», «repair», the rest written off
const stockOf = (plan: Plan) => ({
  removedTo: plan.objects + Math.round(plan.clients * 0.16),
  repairTo: plan.objects + Math.round(plan.clients * 0.18),
});

// The tracker of every twentieth object was replaced: the old one is in the stock, right after the objects
const replacedDevice = (plan: Plan, objectN: string) => `${plan.objects} + ${objectN} / 20`;

const sims: Step = {
  name: "sims",
  rows: (plan) => plan.sims,
  chunk: CHUNK,
  sql: (_plan, from, to) => {
    const q = new Sql();
    const code = q.word({ shown: PHONE_CODES, norm: PHONE_CODES }, "shown", "n");
    return [
      q.statement(`INSERT INTO sims (id, iccid, iccid_rev, msisdn, msisdn_rev, operator_id, plan_id, status,
             archived_at, archived_by, archive_batch_id)
           SELECT s.id, x.iccid, reverse(x.iccid), x.msisdn, reverse(substr(x.msisdn, 2)), op.id, pl.id,
             (CASE WHEN o.n IS NOT NULL THEN CASE WHEN o.archived THEN 'free' ELSE 'active' END
                   WHEN x.n % 7 = 0 THEN 'blocked' ELSE 'free' END)::sim_status,
             CASE WHEN b.batch_id IS NOT NULL THEN now() - interval '5 days' END,
             CASE WHEN b.batch_id IS NOT NULL THEN a.id END,
             b.batch_id
           FROM (
             SELECT n, '89380' || lpad(((n::bigint * 7919 + 101) % 1000000000000000)::text, 15, '0') AS iccid,
               CASE WHEN n % 10 <> 0 THEN '+380' || ${code} || lpad(((n / 12)::bigint * 7919 % 10000000)::text, 7, '0')
               END AS msisdn
             FROM generate_series(${from}, ${to}) n
           ) x
           JOIN seed.sim s ON s.n = x.n
           LEFT JOIN seed.object o ON o.n = x.n
           JOIN seed.ref op ON op.kind = 'operator' AND op.n = 1 + x.n % 3
           JOIN seed.ref pl ON pl.kind = 'plan' AND pl.n = (op.n - 1) * 2 + 1 + (x.n / 3) % 2
           JOIN seed.ref a ON a.kind = 'user' AND a.n = 1
           CROSS JOIN LATERAL (SELECT CASE WHEN o.n IS NULL AND x.n % 50 = 7 THEN uuidv7() END AS batch_id) b
           ORDER BY x.n`),
    ];
  },
};

// A tracker on an object carries the SIM of the same number (D71: only while it is on the object)
const devices: Step = {
  name: "devices",
  rows: (plan) => plan.devices,
  chunk: CHUNK,
  sql: (plan, from, to) => {
    const { removedTo, repairTo } = stockOf(plan);
    return [
      sql(`INSERT INTO devices (id, imei, imei_rev, model_id, status, current_sim_id, archived_at, archived_by,
             archive_batch_id)
           SELECT d.id, x.imei, reverse(x.imei), CASE WHEN x.n % 20 <> 0 THEN m.id END,
             (CASE WHEN o.n IS NOT NULL THEN CASE WHEN o.archived THEN 'removed' ELSE 'installed' END
                   WHEN x.n <= ${removedTo} THEN 'removed' WHEN x.n <= ${repairTo} THEN 'repair'
                   ELSE 'written_off' END)::device_status,
             CASE WHEN o.n IS NOT NULL AND NOT o.archived THEN sm.id END,
             CASE WHEN b.batch_id IS NOT NULL THEN now() - interval '5 days' END,
             CASE WHEN b.batch_id IS NOT NULL THEN a.id END,
             b.batch_id
           FROM (
             SELECT n, '35' || lpad(((n::bigint * 7919 + 7) % 10000000000000)::text, 13, '0') AS imei
             FROM generate_series(${from}, ${to}) n
           ) x
           JOIN seed.device d ON d.n = x.n
           LEFT JOIN seed.object o ON o.n = x.n
           LEFT JOIN seed.sim sm ON sm.n = x.n
           JOIN seed.ref m ON m.kind = 'model' AND m.n = 1 + x.n % 10
           JOIN seed.ref a ON a.kind = 'user' AND a.n = 1
           CROSS JOIN LATERAL (
             SELECT CASE WHEN o.n IS NULL AND x.n > ${repairTo} AND x.n % 2 = 0 THEN uuidv7() END AS batch_id
           ) b
           ORDER BY x.n`),
    ];
  },
};

function objectName(q: Sql, form: keyof WordList) {
  const letter = (index: string) => q.word(WORDS.plateLetters, form, index);
  return `${q.word(WORDS.objectKinds, form, "x.n * 7")} || ' ' || ${letter("x.n")} || ${letter("x.n / 12")} || ' '
    || lpad((x.n::bigint * 7919 % 10000)::text, 4, '0') || ' ' || ${letter("x.n / 144")} || ${letter("x.n * 5")}`;
}

// Every twentieth object at number 7 has a tariff of its own; a disconnected one keeps its tracker until the archive
const objects: Step = {
  name: "objects",
  rows: (plan) => plan.objects,
  chunk: CHUNK,
  sql: (_plan, from, to) => {
    const q = new Sql();
    return [
      q.statement(`INSERT INTO objects (id, subscriber_id, name, name_norm, status, status_from, connected_on,
             disconnected_on, disconnect_reason_id, payer_id, tariff_id, program_id, server_id, has_own_tariff,
             current_device_id, archived_at, archived_by, archive_batch_id)
           SELECT o.id, c.id, ${objectName(q, "shown")}, ${objectName(q, "norm")}, o.status,
             x.connected + CASE o.status WHEN 'active' THEN 0 WHEN 'suspended' THEN ${SUSPENDED_AFTER}
                                         ELSE ${DISCONNECTED_AFTER} END,
             x.connected,
             CASE WHEN o.status = 'disconnected' THEN x.connected + ${DISCONNECTED_AFTER} END,
             CASE WHEN o.status = 'disconnected' THEN r.id END,
             p.id,
             coalesce(own.id, t.id), coalesce(own.parent_id, t.program_id), coalesce(own.server_id, t.server_id),
             own.id IS NOT NULL,
             CASE WHEN NOT o.archived THEN d.id END,
             CASE WHEN o.archived THEN coalesce(s.archived_at, now() - interval '10 days') END,
             CASE WHEN o.archived THEN a.id END,
             o.batch_id
           FROM (SELECT n, DATE '2020-01-01' + (n * 37 % 2300) AS connected FROM generate_series(${from}, ${to}) n) x
           JOIN seed.object o ON o.n = x.n
           JOIN seed.client c ON c.n = o.client_n
           JOIN subscribers s ON s.id = c.id
           JOIN tariffs t ON t.id = s.tariff_id
           JOIN seed.payer p ON p.n = o.client_n
           JOIN seed.device d ON d.n = x.n
           JOIN seed.ref r ON r.kind = 'reason' AND r.n = 1 + x.n % 5
           JOIN seed.ref a ON a.kind = 'user' AND a.n = 1
           LEFT JOIN seed.ref own ON x.n % 20 = 7 AND own.kind = 'tariff' AND own.n = 1 + (x.n * 13) % 60
           ORDER BY x.n`),
    ];
  },
};

// The objects of a chunk with their numbers, for the histories below
const chunkObjects = (from: number, to: number) =>
  `objects o JOIN seed.object so ON so.id = o.id WHERE so.n BETWEEN ${from} AND ${to}`;

const installedFrom = `o.connected_on + CASE WHEN so.n % 20 = 0 THEN ${REPLACED_AFTER} ELSE 0 END`;
const installedTo = "o.archived_at::date";

// The dated histories of every object (§3.4): status, terms, services, the tracker and its SIM
const histories: Step = {
  name: "histories",
  rows: (plan) => plan.objects,
  chunk: CHUNK,
  sql: (plan, from, to) => [
    sql(`INSERT INTO object_status_periods (object_id, status, valid_from, valid_to, reason_id)
         SELECT o.id, 'active', o.connected_on, CASE WHEN o.status <> 'active' THEN o.status_from END, NULL
         FROM ${chunkObjects(from, to)}
         UNION ALL
         SELECT o.id, o.status, o.status_from, NULL, o.disconnect_reason_id
         FROM ${chunkObjects(from, to)} AND o.status <> 'active'`),
    sql(`INSERT INTO object_service_terms (object_id, payer_id, own_tariff_id, valid_from)
         SELECT o.id, o.payer_id, CASE WHEN o.has_own_tariff THEN o.tariff_id END, o.connected_on
         FROM ${chunkObjects(from, to)}`),
    // Every program has all four services, so any one fits
    sql(`INSERT INTO object_addon_periods (object_id, addon_id, valid_from)
         SELECT o.id, ad.id, o.connected_on
         FROM objects o JOIN seed.object so ON so.id = o.id
         JOIN seed.ref ad ON ad.kind = 'addon' AND ad.n = 1 + so.n % 4
         WHERE so.n BETWEEN ${from} AND ${to} AND so.n % 10 = 3 AND o.archived_at IS NULL`),
    sql(`INSERT INTO device_installations (object_id, device_id, valid_from, valid_to, contractor_id)
         SELECT o.id, d.id, ${installedFrom}, ${installedTo}, ct.id
         FROM objects o JOIN seed.object so ON so.id = o.id
         JOIN seed.device d ON d.n = so.n
         JOIN seed.ref ct ON ct.kind = 'contractor' AND ct.n = 1 + so.n % 10
         WHERE so.n BETWEEN ${from} AND ${to}
         UNION ALL
         SELECT o.id, d.id, o.connected_on, o.connected_on + ${REPLACED_AFTER}, ct.id
         FROM objects o JOIN seed.object so ON so.id = o.id
         JOIN seed.device d ON d.n = ${replacedDevice(plan, "so.n")}
         JOIN seed.ref ct ON ct.kind = 'contractor' AND ct.n = 1 + so.n % 10
         WHERE so.n BETWEEN ${from} AND ${to} AND so.n % 20 = 0`),
    sql(`INSERT INTO sim_installations (device_id, sim_id, valid_from, valid_to, contractor_id)
         SELECT d.id, sm.id, ${installedFrom}, ${installedTo}, ct.id
         FROM objects o JOIN seed.object so ON so.id = o.id
         JOIN seed.device d ON d.n = so.n
         JOIN seed.sim sm ON sm.n = so.n
         JOIN seed.ref ct ON ct.kind = 'contractor' AND ct.n = 1 + so.n % 10
         WHERE so.n BETWEEN ${from} AND ${to}`),
  ],
};

// A sensor number n stands on the object 20n + 1, which is never in the archive; the last ones are archived from stock.
// Created in an order of their own, as the trackers (seed-scale.clients.ts, maps)
const sensors: Step = {
  name: "sensors",
  rows: (plan) => plan.sensors,
  chunk: CHUNK,
  sql: (plan, from, to) => [
    sql(`INSERT INTO sensors (serial_no, serial_no_norm, archived_at, archived_by, archive_batch_id)
         SELECT 'ДУТ-' || lpad(g.n::text, 7, '0'), 'дут-' || lpad(g.n::text, 7, '0'),
           CASE WHEN b.batch_id IS NOT NULL THEN now() - interval '5 days' END,
           CASE WHEN b.batch_id IS NOT NULL THEN a.id END, b.batch_id
         FROM generate_series(${from}, ${to}) g(n)
         JOIN seed.ref a ON a.kind = 'user' AND a.n = 1
         CROSS JOIN LATERAL (
           SELECT CASE WHEN g.n > ${Math.round(plan.clients * 0.19)} THEN uuidv7() END AS batch_id
         ) b
         ORDER BY (g.n::bigint * 7919) % ${plan.sensors}`),
    sql(`INSERT INTO sensor_installations (object_id, sensor_id, valid_from, contractor_id)
         SELECT o.id, se.id, o.connected_on + 10, ct.id
         FROM generate_series(${from}, ${Math.min(to, plan.sensorsInstalled)}) g(n)
         JOIN sensors se ON se.serial_no = 'ДУТ-' || lpad(g.n::text, 7, '0')
         JOIN seed.object so ON so.n = 20 * g.n + 1
         JOIN objects o ON o.id = so.id
         JOIN seed.ref ct ON ct.kind = 'contractor' AND ct.n = 1 + g.n % 10`),
  ],
};

export const OBJECT_STEPS: Step[] = [sims, devices, objects, histories, sensors];
