import { sql, type Plan, type Statement, type Step } from "./seed-scale.plan.js";

const EVENT_CHUNK = 500_000;
// The journal of a year: the start page reads 90 days of it by the author, and the screen filters by months
const JOURNAL_DAYS = 360;
const USERS = 20;

// subscribers.md П17, the same as deriveSubscriberStatus and the job subscribers.rollup-reconcile: what the live objects say
const rollup: Step = {
  name: "rollup",
  rows: (plan) => plan.clients,
  sql: () => [
    sql(`UPDATE subscribers s
         SET objects_active = f.active, objects_suspended = f.suspended, objects_disconnected = f.disconnected,
           status = (CASE WHEN f.active + f.suspended = 0 THEN 'disconnected' WHEN f.active = 0 THEN 'suspended'
                          WHEN f.suspended > 0 THEN 'partially_suspended' ELSE 'active' END)::subscriber_status
         FROM (
           SELECT subscriber_id, count(*) FILTER (WHERE status = 'active')::int AS active,
             count(*) FILTER (WHERE status = 'suspended')::int AS suspended,
             count(*) FILTER (WHERE status = 'disconnected')::int AS disconnected
           FROM objects WHERE archived_at IS NULL GROUP BY subscriber_id
         ) f
         WHERE s.id = f.subscriber_id`),
    // П9 of references.md: a tariff a client or an object took has its price fixed
    sql(`UPDATE tariffs SET selected_at = now()
         WHERE id IN (SELECT DISTINCT tariff_id FROM subscribers UNION SELECT DISTINCT tariff_id FROM objects)`),
  ],
};

// The records name their package, the packages come from them: a client's package holds its objects, contacts,
// contracts and payers; the rest went to the archive one by one
const batches: Step = {
  name: "batches",
  rows: () => 1,
  sql: () => {
    const single = (table: string, kind: string, label: string, subscriber: string, onlyOwn: string) =>
      sql(`INSERT INTO archive_batches (id, entity_type, label, item_count, subscriber_id, archived_at, archived_by)
           SELECT r.archive_batch_id, '${kind}', ${label}, 1, ${subscriber}, r.archived_at, r.archived_by
           FROM ${table} r ${onlyOwn}
           WHERE r.archived_at IS NOT NULL`);
    const ofLiveClient = "JOIN subscribers s ON s.id = r.subscriber_id AND s.archived_at IS NULL";
    return [
      sql(`INSERT INTO archive_batches (id, entity_type, label, item_count, subscriber_id, archived_at, archived_by)
           SELECT s.archive_batch_id, 'subscriber', 'Клієнт: ' || s.name,
             1 + (SELECT count(*) FROM objects o WHERE o.subscriber_id = s.id)
               + (SELECT count(*) FROM contacts c WHERE c.subscriber_id = s.id)
               + (SELECT count(*) FROM contracts k WHERE k.subscriber_id = s.id)
               + (SELECT count(*) FROM payers p WHERE p.archive_batch_id = s.archive_batch_id),
             s.id, s.archived_at, s.archived_by
           FROM subscribers s WHERE s.archived_at IS NOT NULL`),
      single("objects", "object", "'Об''єкт: ' || r.name", "r.subscriber_id", ofLiveClient),
      single("contacts", "contact", "'Контакт: ' || r.full_name", "r.subscriber_id", ofLiveClient),
      single("devices", "device", "'Трекер: ' || r.imei", "NULL", ""),
      single("sims", "sim", "'SIM-картка: ' || r.iccid", "NULL", ""),
      single("sensors", "sensor", "'Датчик: ' || r.serial_no", "NULL", ""),
    ];
  },
};

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

const partitionName = (month: Date) =>
  `activity_events_${month.getUTCFullYear()}_${String(month.getUTCMonth() + 1).padStart(2, "0")}`;

// The months of the year back, by the same names and UTC bounds as ensure_activity_partitions: the migration and the
// job only create months ahead
function pastPartitions(now: Date): Statement[] {
  const statements: Statement[] = [];
  const first = monthStart(new Date(now.getTime() - (JOURNAL_DAYS + 1) * 86_400_000));
  for (let month = first; month < monthStart(now);) {
    const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
    statements.push(
      sql(`CREATE TABLE IF NOT EXISTS part.${partitionName(month)} PARTITION OF activity_events
           FOR VALUES FROM ('${month.toISOString()}') TO ('${next.toISOString()}')`),
    );
    month = next;
  }
  return statements;
}

const partitions: Step = {
  name: "partitions",
  rows: () => 1,
  sql: () => pastPartitions(new Date()),
};

// Spread evenly over the year, oldest first, by the 20 users in turn: four in ten about an object, four about a client,
// two about a tracker
const events: Step = {
  name: "events",
  rows: (plan) => plan.events,
  chunk: EVENT_CHUNK,
  sql: (plan: Plan, from, to) => [
    sql(`INSERT INTO activity_events (occurred_at, actor_kind, actor_id, action, entity_type, entity_id, subscriber_id,
           changes, ip, request_id)
         SELECT now() - ((${plan.events} - x.e)::float8 / ${plan.events}) * interval '${JOURNAL_DAYS} days',
           'user', u.id,
           CASE x.kind WHEN 0 THEN (ARRAY['object.updated', 'object.status_changed', 'object.terms_changed'])[1 + x.e % 3]
                       WHEN 1 THEN (ARRAY['subscriber.updated', 'subscriber.tariff_changed'])[1 + x.e % 2]
                       ELSE 'device.updated' END,
           CASE x.kind WHEN 0 THEN 'object' WHEN 1 THEN 'subscriber' ELSE 'device' END,
           CASE x.kind WHEN 0 THEN so.id WHEN 1 THEN sc.id ELSE sd.id END,
           CASE x.kind WHEN 0 THEN oc.id WHEN 1 THEN sc.id END,
           jsonb_build_object('note', jsonb_build_array(NULL, 'Примітка ' || x.e)),
           '10.0.' || (x.e % 250) || '.' || (x.e % 199 + 1),
           'seed-' || x.e
         FROM (
           SELECT e, CASE WHEN e % 10 < 4 THEN 0 WHEN e % 10 < 8 THEN 1 ELSE 2 END AS kind
           FROM generate_series(${from}, ${to}) e
         ) x
         JOIN seed.ref u ON u.kind = 'user' AND u.n = 1 + x.e % ${USERS}
         LEFT JOIN seed.object so ON x.kind = 0 AND so.n = (x.e::bigint * 104729 % ${plan.objects})::int + 1
         LEFT JOIN seed.client oc ON oc.n = so.client_n
         LEFT JOIN seed.client sc ON x.kind = 1 AND sc.n = (x.e::bigint * 7919 % ${plan.clients})::int + 1
         LEFT JOIN seed.device sd ON x.kind = 2 AND sd.n = (x.e::bigint * 31 % ${plan.devices})::int + 1
         ORDER BY x.e`),
  ],
};

const SEEDED_TABLES = [
  "subscribers",
  "subscriber_tariff_periods",
  "payers",
  "payer_subscribers",
  "contacts",
  "contracts",
  "sims",
  "devices",
  "objects",
  "object_status_periods",
  "object_service_terms",
  "object_addon_periods",
  "device_installations",
  "sim_installations",
  "sensors",
  "sensor_installations",
  "archive_batches",
  "tariffs",
  "activity_events",
];

// The rollup rewrote every client, which left the table twice its size: a load writes each row once
const REWRITTEN_TABLES = new Set(["subscribers"]);

// Fresh statistics and a visibility map, as autovacuum leaves a table some time after a load: the plans measured are
// then the plans of a working database
const vacuum: Step = {
  name: "vacuum",
  rows: () => SEEDED_TABLES.length,
  isOutsideTransaction: true,
  sql: () =>
    SEEDED_TABLES.map((table) => sql(`VACUUM (${REWRITTEN_TABLES.has(table) ? "FULL, " : ""}ANALYZE) ${table}`)),
};

export const FINISH_STEPS: Step[] = [rollup, batches, partitions, events, vacuum];
