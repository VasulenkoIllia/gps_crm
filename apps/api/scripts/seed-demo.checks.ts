import type pg from "pg";

// Run in the transaction of the seed, before the commit: each counts the rows the app would read differently from what
// its own rules give. Any count above zero undoes the whole run.
const CHECKS: { what: string; sql: string }[] = [
  {
    what: "client counts and status differ from their live objects (subscribers.md П17)",
    sql: `SELECT count(*) AS wrong FROM subscribers s
          LEFT JOIN (
            SELECT subscriber_id, count(*) FILTER (WHERE status = 'active') AS active,
              count(*) FILTER (WHERE status = 'suspended') AS suspended,
              count(*) FILTER (WHERE status = 'disconnected') AS disconnected
            FROM objects WHERE archived_at IS NULL GROUP BY subscriber_id
          ) f ON f.subscriber_id = s.id
          WHERE s.objects_active <> coalesce(f.active, 0) OR s.objects_suspended <> coalesce(f.suspended, 0)
            OR s.objects_disconnected <> coalesce(f.disconnected, 0)
            OR s.status <> (CASE WHEN coalesce(f.active, 0) + coalesce(f.suspended, 0) = 0 THEN 'disconnected'
                                 WHEN coalesce(f.active, 0) = 0 THEN 'suspended'
                                 WHEN coalesce(f.suspended, 0) > 0 THEN 'partially_suspended'
                                 ELSE 'active' END)::subscriber_status`,
  },
  {
    what: "a client's tariff is not its newest version (D60, D91)",
    sql: `SELECT count(*) AS wrong FROM subscribers s
          LEFT JOIN LATERAL (SELECT tariff_id, valid_from FROM subscriber_tariff_periods p WHERE p.subscriber_id = s.id
                             ORDER BY valid_from DESC, id DESC LIMIT 1) p ON true
          WHERE s.tariff_id IS DISTINCT FROM p.tariff_id OR s.tariff_from IS DISTINCT FROM p.valid_from`,
  },
  {
    what: "an object's payer or tariff is not its newest terms (D70)",
    sql: `SELECT count(*) AS wrong FROM objects o JOIN subscribers s ON s.id = o.subscriber_id
          LEFT JOIN LATERAL (SELECT payer_id, own_tariff_id FROM object_service_terms t WHERE t.object_id = o.id
                             ORDER BY valid_from DESC, id DESC LIMIT 1) t ON true
          WHERE t.payer_id IS NULL OR o.payer_id IS DISTINCT FROM t.payer_id
            OR o.has_own_tariff <> (t.own_tariff_id IS NOT NULL)
            OR o.tariff_id IS DISTINCT FROM coalesce(t.own_tariff_id, s.tariff_id)`,
  },
  {
    what: "an object's status is not its newest status period",
    sql: `SELECT count(*) AS wrong FROM objects o
          LEFT JOIN LATERAL (SELECT status, valid_from FROM object_status_periods p WHERE p.object_id = o.id
                             ORDER BY valid_from DESC, id DESC LIMIT 1) p ON true
          WHERE o.status IS DISTINCT FROM p.status OR o.status_from IS DISTINCT FROM p.valid_from`,
  },
  {
    what: "a tracker on an object is not installed there, or its SIM is not in it (D71)",
    sql: `SELECT count(*) AS wrong FROM objects o JOIN devices d ON d.id = o.current_device_id
          WHERE d.status <> 'installed' OR d.current_sim_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM device_installations i
                           WHERE i.object_id = o.id AND i.device_id = d.id AND i.valid_to IS NULL)
            OR NOT EXISTS (SELECT 1 FROM sim_installations i
                           WHERE i.device_id = d.id AND i.sim_id = d.current_sim_id AND i.valid_to IS NULL)`,
  },
  {
    what: "equipment off every object still has an open installation",
    sql: `SELECT count(*) AS wrong FROM devices d
          WHERE NOT EXISTS (SELECT 1 FROM objects o WHERE o.current_device_id = d.id)
            AND (d.status = 'installed' OR d.current_sim_id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM device_installations i WHERE i.device_id = d.id AND i.valid_to IS NULL))`,
  },
  {
    what: "a free SIM sits in a tracker, an active one in none, or an open SIM installation is not its tracker's SIM",
    sql: `SELECT (SELECT count(*) FROM sims s
                  WHERE (s.status = 'free') = EXISTS (SELECT 1 FROM devices d WHERE d.current_sim_id = s.id)
                    AND s.status <> 'blocked')
               + (SELECT count(*) FROM sim_installations i JOIN devices d ON d.id = i.device_id
                  WHERE i.valid_to IS NULL AND d.current_sim_id IS DISTINCT FROM i.sim_id) AS wrong`,
  },
  {
    what: "a client's number is outside the series of its type, or the series would hand it out again (D35)",
    sql: `SELECT count(*) AS wrong FROM subscribers s
          WHERE NOT EXISTS (SELECT 1 FROM subscriber_id_series r JOIN subscriber_id_series_types t ON t.series_id = r.id
                            WHERE t.type = s.type AND s.code BETWEEN r.range_from AND r.range_to
                              AND r.next_number > s.code)`,
  },
  {
    what: "a line of the demo's journal is dated later than now",
    sql: "SELECT count(*) AS wrong FROM activity_events WHERE request_id LIKE 'demo-seed-%' AND occurred_at > now()",
  },
  {
    what: "a package of the archive does not hold the records that name it",
    sql: `SELECT count(*) AS wrong FROM archive_batches b
          WHERE b.item_count <> (SELECT count(*) FROM subscribers r WHERE r.archive_batch_id = b.id)
            + (SELECT count(*) FROM objects r WHERE r.archive_batch_id = b.id)
            + (SELECT count(*) FROM contacts r WHERE r.archive_batch_id = b.id)
            + (SELECT count(*) FROM contracts r WHERE r.archive_batch_id = b.id)
            + (SELECT count(*) FROM payers r WHERE r.archive_batch_id = b.id)
            + (SELECT count(*) FROM devices r WHERE r.archive_batch_id = b.id)`,
  },
  {
    what: "a tariff a client or an object took has no fixed price (references.md П9)",
    sql: `SELECT count(*) AS wrong FROM tariffs t WHERE t.selected_at IS NULL
            AND (EXISTS (SELECT 1 FROM subscriber_tariff_periods p WHERE p.tariff_id = t.id)
                 OR EXISTS (SELECT 1 FROM objects o WHERE o.tariff_id = t.id))`,
  },
  {
    what: "lines of the demo's journal fell into the default partition (activity.md П6)",
    sql: "SELECT count(*) AS wrong FROM part.activity_events_default WHERE request_id LIKE 'demo-seed-%'",
  },
];

export async function checkDemo(db: pg.Client): Promise<void> {
  for (const check of CHECKS) {
    const { rows } = await db.query<{ wrong: string }>(check.sql);
    const wrong = Number(rows[0]?.wrong);
    if (!Number.isFinite(wrong) || wrong > 0) throw new Error(`check failed, ${rows[0]?.wrong} rows: ${check.what}`);
  }
}

// Every row the seed meant is there, and it meant some of each: a demo left empty would pass every check above
export async function checkWritten(db: pg.Client, planned: [table: string, count: number][]): Promise<void> {
  for (const [table, count] of planned) {
    if (count === 0) throw new Error(`the demo writes no rows of ${table}`);
    const where = table === "activity_events" ? " WHERE request_id LIKE 'demo-seed-%'" : "";
    const { rows } = await db.query<{ count: string }>(`SELECT count(*) AS count FROM ${table}${where}`);
    if (Number(rows[0]?.count) !== count) throw new Error(`${table}: ${rows[0]?.count} rows, the demo wrote ${count}`);
  }
}
