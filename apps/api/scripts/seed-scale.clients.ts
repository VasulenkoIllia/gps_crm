import { SEED_CODE_FROM, SEED_CODE_TO, Sql, sql, type Plan, type Statement, type Step } from "./seed-scale.plan.js";
import { PHONE_CODES, WORDS, type WordList } from "./seed-scale.words.js";

const USERS = 20;
// Users 1..16 manage clients: the two administrators and the managers. 17..20 are technicians.
const MANAGERS = 16;
const TARIFFS = 60;
const CHUNK = 100_000;

// A client of every fortieth number past the multi-object fifth is in the archive: it has one object, so a client in
// the archive never holds a working one (subscribers.md П19)
export const archivedClient = (n: string, plan: Plan) => `(${n} % 40 = 0 AND ${n} > ${plan.multiObjectClients})`;

// A tax id with its check digit, as packages/shared/src/tax-id.ts checks it: seed.edrpou takes 7 digits, seed.ipn 9.
// ЄДРПОУ: the digit that makes the code valid, so the shifted weights between 30 and 60 million need no case of their own.
export const TAX_ID_FUNCTIONS = `
  CREATE OR REPLACE FUNCTION seed.edrpou(head bigint) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
  DECLARE
    digits text := lpad((head % 10000000)::text, 7, '0');
    code text; weights int[]; total int; remainder int;
  BEGIN
    FOR check_digit IN 0..9 LOOP
      code := digits || check_digit;
      weights := CASE WHEN code::bigint BETWEEN 30000000 AND 60000000 THEN ARRAY[7,1,2,3,4,5,6]
                      ELSE ARRAY[1,2,3,4,5,6,7] END;
      total := 0;
      FOR i IN 1..7 LOOP total := total + weights[i] * substr(digits, i, 1)::int; END LOOP;
      remainder := total % 11;
      IF remainder > 9 THEN
        total := 0;
        FOR i IN 1..7 LOOP total := total + (weights[i] + 2) * substr(digits, i, 1)::int; END LOOP;
        remainder := total % 11;
        IF remainder > 9 THEN remainder := 0; END IF;
      END IF;
      IF remainder = check_digit THEN RETURN code; END IF;
    END LOOP;
    RAISE EXCEPTION 'no check digit for %', digits;
  END $$;
  CREATE OR REPLACE FUNCTION seed.ipn(head bigint) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
  DECLARE
    digits text := lpad((head % 1000000000)::text, 9, '0');
    weights int[] := ARRAY[-1,5,7,9,4,6,10,5,7];
    total int := 0;
  BEGIN
    FOR i IN 1..9 LOOP total := total + weights[i] * substr(digits, i, 1)::int; END LOOP;
    RETURN digits || ((total % 11 + 11) % 11 % 10);
  END $$;
`;

function namedReference(kind: string, table: string, count: number, word: string, hasSort = true): Statement[] {
  const norm = word.toLowerCase();
  const sort = hasSort ? ", sort_order" : "";
  return [
    sql(`INSERT INTO seed.ref (kind, n, id) SELECT '${kind}', n, uuidv7() FROM generate_series(1, ${count}) n`),
    sql(`INSERT INTO ${table} (id, name, name_norm${sort})
         SELECT id, '${word} ' || n, '${norm} ' || n${hasSort ? ", n" : ""} FROM seed.ref WHERE kind = '${kind}'`),
  ];
}

const references: Step = {
  name: "references",
  rows: () => 1,
  sql: () => [
    ...namedReference("program", "programs", 3, "Програма"),
    sql(`INSERT INTO seed.ref (kind, n, id, parent_id)
         SELECT 'server', s.n, uuidv7(), p.id FROM generate_series(1, 6) s(n)
         JOIN seed.ref p ON p.kind = 'program' AND p.n = (s.n + 1) / 2`),
    sql(`INSERT INTO monitoring_servers (id, program_id, name, name_norm)
         SELECT id, parent_id, 'Сервер ' || n, 'сервер ' || n FROM seed.ref WHERE kind = 'server'`),
    // Ten per server: five names, each by the month and by the year (D54)
    sql(`INSERT INTO seed.ref (kind, n, id, parent_id, server_id)
         SELECT 'tariff', (s.n - 1) * 10 + k, uuidv7(), s.parent_id, s.id
         FROM seed.ref s CROSS JOIN generate_series(1, 10) k WHERE s.kind = 'server'`),
    sql(`INSERT INTO tariffs (id, program_id, server_id, name, name_norm, billing_model, price_kop)
         SELECT id, parent_id, server_id,
           'Тариф ' || (ARRAY['Базовий', 'Стандарт', 'Плюс', 'Флот', 'Преміум'])[((n - 1) % 10) / 2 + 1],
           'тариф ' || (ARRAY['базовий', 'стандарт', 'плюс', 'флот', 'преміум'])[((n - 1) % 10) / 2 + 1],
           (CASE WHEN n % 2 = 1 THEN 'month' ELSE 'year' END)::billing_model,
           (15000 + 2500 * (((n - 1) % 10) / 2)) * (CASE WHEN n % 2 = 1 THEN 1 ELSE 11 END)
         FROM seed.ref WHERE kind = 'tariff'`),
    ...namedReference("addon", "addons", 4, "Послуга", false),
    sql(`INSERT INTO addon_prices (addon_id, price_kop, valid_from)
         SELECT id, 5000 * n, DATE '2024-01-01' FROM seed.ref WHERE kind = 'addon'`),
    sql(`INSERT INTO addon_programs (addon_id, program_id)
         SELECT a.id, p.id FROM seed.ref a JOIN seed.ref p ON p.kind = 'program' WHERE a.kind = 'addon'`),
    ...namedReference("model", "tracker_models", 10, "Модель"),
    ...namedReference("operator", "sim_operators", 3, "Оператор"),
    sql(`INSERT INTO seed.ref (kind, n, id, parent_id)
         SELECT 'plan', (o.n - 1) * 2 + k, uuidv7(), o.id
         FROM seed.ref o CROSS JOIN generate_series(1, 2) k WHERE o.kind = 'operator'`),
    sql(`INSERT INTO sim_plans (id, operator_id, name, name_norm, sort_order)
         SELECT id, parent_id, 'План ' || n, 'план ' || n, n FROM seed.ref WHERE kind = 'plan'`),
    ...namedReference("contractor", "contractors", 10, "Монтажник"),
    ...namedReference("reason", "disconnect_reasons", 5, "Причина"),
  ],
};

// Signed in by a session the seed hands to k6 (seed-scale.ts --prepare-run): no password, 2FA marked as set up
const users: Step = {
  name: "users",
  rows: () => USERS,
  sql: () => [
    sql(`INSERT INTO seed.ref (kind, n, id) SELECT 'user', n, uuidv7() FROM generate_series(1, ${USERS}) n`),
    sql(`INSERT INTO users (id, email, full_name, role_id, status)
         SELECT u.id, 'scale-' || lpad(u.n::text, 2, '0') || '@example.test', 'Користувач Сиду ' || lpad(u.n::text, 2, '0'),
           r.id, 'active'
         FROM seed.ref u
         JOIN roles r ON r.key = CASE WHEN u.n <= 2 THEN 'admin' WHEN u.n <= ${MANAGERS} THEN 'manager' ELSE 'technician' END
         WHERE u.kind = 'user'`),
    sql(`INSERT INTO two_factor_credentials (user_id, secret_encrypted, confirmed_at)
         SELECT id, 'seed-scale', now() FROM seed.ref WHERE kind = 'user'`),
  ],
};

// D35: the seed takes a series of its own, only in its own database. A client created during the k6 run gets the next
// seven-digit ID.
const series: Step = {
  name: "series",
  rows: () => 1,
  sql: (plan) => [
    sql(`WITH created AS (
           INSERT INTO subscriber_id_series (name, name_norm, range_from, range_to, next_number)
           VALUES ('Сид масштабу', 'сид масштабу', ${SEED_CODE_FROM}, ${SEED_CODE_TO}, ${SEED_CODE_FROM + plan.clients})
           RETURNING id)
         UPDATE subscriber_id_series_types SET series_id = (SELECT id FROM created)`),
  ],
};

// The numbers of the seed and the ids they got, so every later step joins by number. uuidv7 in order of the number,
// as records made one after another get.
const maps: Step = {
  name: "maps",
  rows: (plan) => plan.clients + plan.objects + plan.devices + plan.sims + plan.payers,
  sql: (plan) => {
    const { clients: c, multiObjectClients: s, fleetObjects: f } = plan;
    return [
      sql(`INSERT INTO seed.client (n, id, type, archived, batch_id)
           SELECT n, uuidv7(),
             (CASE WHEN n % 50 < 40 THEN 'B2C' WHEN n % 50 < 49 THEN 'B2B' ELSE 'B2G' END)::subscriber_type,
             ${archivedClient("n", plan)}, CASE WHEN ${archivedClient("n", plan)} THEN uuidv7() END
           FROM generate_series(1, ${c}) n`),
      // One object for every client, then 50 fleets, then the rest spread over the first fifth of the clients
      sql(`INSERT INTO seed.object (n, id, client_n, status, archived, batch_id)
           SELECT m.n, uuidv7(), m.client_n,
             (CASE WHEN c.archived OR m.n % 100 = 50 THEN 'disconnected' WHEN m.n % 100 < 85 THEN 'active'
                   WHEN m.n % 100 < 92 THEN 'suspended' ELSE 'disconnected' END)::object_status,
             c.archived OR m.n % 100 = 50,
             CASE WHEN c.archived THEN c.batch_id WHEN m.n % 100 = 50 THEN uuidv7() END
           FROM (
             SELECT n, CASE WHEN n <= ${c} THEN n
                            WHEN n - ${c} <= ${f} THEN (((n - ${c} - 1) % 50) + 1) * 7919 % ${s} + 1
                            ELSE ((n - ${c})::bigint * 104729 % ${s})::int + 1 END AS client_n
             FROM generate_series(1, ${plan.objects}) n
           ) m
           JOIN seed.client c ON c.n = m.client_n
           ORDER BY m.n`),
      // Equipment is bought, installed and written off at any time: created in an order of its own, so the newest
      // trackers and SIMs are not all the stock and the archive, and a list «newest first» meets them as it would
      ...[
        ["device", plan.devices],
        ["sim", plan.sims],
      ].map(([table, count]) =>
        sql(`INSERT INTO seed.${table} (n, id)
             SELECT n, uuidv7() FROM (SELECT n FROM generate_series(1, ${count}) n ORDER BY (n::bigint * 7919) % ${count}) s`),
      ),
      // A payer for every client, then second payers of clients picked across the whole range
      sql(`INSERT INTO seed.payer (n, id, client_n, archived, batch_id)
           SELECT p.n, uuidv7(), p.client_n, c.archived, c.batch_id
           FROM (SELECT n, CASE WHEN n <= ${c} THEN n ELSE ((n - ${c})::bigint * 7919 % ${c})::int + 1 END AS client_n
                 FROM generate_series(1, ${plan.payers}) n) p
           JOIN seed.client c ON c.n = p.client_n
           ORDER BY p.n`),
      sql("ANALYZE seed.client, seed.object, seed.device, seed.sim, seed.payer"),
    ];
  },
};

function clientName(q: Sql, form: keyof WordList, n: string) {
  const person = `${q.word(WORDS.surnames, form, `${n} * 31`)} || ' ' || ${q.word(WORDS.firstNames, form, `${n} / 40`)}`;
  const company = `${q.word(WORDS.companyFirst, form, `${n} * 13`)} || ' ' || ${q.word(WORDS.companySecond, form, `${n} / 7`)}`;
  const prefix = q.word(WORDS.companyPrefixes, form, n);
  const municipal = form === "shown" ? "'КП '" : "'кп '";
  return `CASE c.type WHEN 'B2C' THEN ${person} WHEN 'B2B' THEN ${prefix} || ' ' || ${company}
                      ELSE ${municipal} || ${company} END`;
}

const subscribers: Step = {
  name: "subscribers",
  rows: (plan) => plan.clients,
  chunk: CHUNK,
  sql: (_plan, from, to) => {
    const q = new Sql();
    return [
      q.statement(`INSERT INTO subscribers (id, code, legacy_code, type, name, name_norm, tax_id, crm_url, manager_id,
             grace_days, program_id, tariff_id, archived_at, archived_by, archive_batch_id)
           SELECT c.id, ${SEED_CODE_FROM} + c.n - 1,
             CASE WHEN c.n % 10 < 7 THEN (c.n::bigint * 7 + 3)::text END,
             c.type, ${clientName(q, "shown", "c.n")}, ${clientName(q, "norm", "c.n")},
             CASE WHEN c.type <> 'B2C' THEN seed.edrpou(c.n::bigint * 7919)
                  WHEN c.n % 2 = 0 THEN seed.ipn(c.n::bigint * 104729) END,
             CASE WHEN c.n % 10 <> 9 THEN 'https://crm.example.test/clients/' || c.n END,
             m.id, (c.n % 4) * 5, t.parent_id, t.id,
             CASE WHEN c.archived THEN now() - interval '30 days' END,
             CASE WHEN c.archived THEN a.id END,
             c.batch_id
           FROM seed.client c
           JOIN seed.ref m ON m.kind = 'user' AND m.n = 1 + c.n % ${MANAGERS}
           JOIN seed.ref t ON t.kind = 'tariff' AND t.n = 1 + (c.n * 7) % ${TARIFFS}
           JOIN seed.ref a ON a.kind = 'user' AND a.n = 1
           WHERE c.n BETWEEN ${from} AND ${to}
           ORDER BY c.n`),
      sql(`INSERT INTO subscriber_tariff_periods (subscriber_id, tariff_id, valid_from)
           SELECT s.id, s.tariff_id, DATE '2020-01-01' + (c.n * 37 % 2300)
           FROM seed.client c JOIN subscribers s ON s.id = c.id
           WHERE c.n BETWEEN ${from} AND ${to}`),
    ];
  },
};

function payerSource(plan: Plan, from: number, to: number, q: Sql) {
  const second = (form: keyof WordList, start: string) =>
    `${start} || ${q.word(WORDS.companyFirst, form, "p.n * 17")} || ' ' || ${q.word(WORDS.companySecond, form, "p.n / 3")}`;
  return `SELECT p.id, p.n, p.archived, p.batch_id, s.type, s.tax_id, s.archived_at, s.archived_by,
            CASE WHEN p.n <= ${plan.clients} THEN s.name ELSE ${second("shown", "'Платник '")} END AS name,
            CASE WHEN p.n <= ${plan.clients} THEN s.name_norm ELSE ${second("norm", "'платник '")} END AS name_norm,
            CASE WHEN p.n > ${plan.clients} THEN 'invoice' WHEN s.type = 'B2C' THEN 'iban'
                 WHEN p.n % 5 = 0 THEN 'vchasno' ELSE 'invoice' END AS method
          FROM seed.payer p JOIN seed.client c ON c.n = p.client_n JOIN subscribers s ON s.id = c.id
          WHERE p.n BETWEEN ${from} AND ${to}`;
}

// K6: one payer may pay for several clients. Every 33rd client also has the payer of the one before, so the archive
// of a client finds payers that stay with another
const payers: Step = {
  name: "payers",
  rows: (plan) => plan.payers,
  chunk: CHUNK * 2,
  sql: (plan, from, to) => {
    const q = new Sql();
    return [
      q.statement(`INSERT INTO payers (id, name, name_norm, payment_method, legal_name, tax_id, vchasno_email,
             details_contact, archived_at, archived_by, archive_batch_id)
           SELECT x.id, x.name, x.name_norm, x.method::payment_method,
             CASE WHEN x.method <> 'iban' THEN x.name END,
             CASE WHEN x.n > ${plan.clients} THEN seed.edrpou(x.n::bigint * 7919) ELSE x.tax_id END,
             CASE WHEN x.method = 'vchasno' THEN 'payer' || x.n || '@example.test' END,
             CASE WHEN x.method = 'iban' THEN 'Реквізити в листуванні з клієнтом' END,
             CASE WHEN x.archived THEN x.archived_at END, CASE WHEN x.archived THEN x.archived_by END, x.batch_id
           FROM (${payerSource(plan, from, to, q)}) x
           ORDER BY x.n`),
      sql(`INSERT INTO payer_subscribers (payer_id, subscriber_id)
           SELECT p.id, c.id FROM seed.payer p JOIN seed.client c ON c.n = p.client_n
           WHERE p.n BETWEEN ${from} AND ${to}`),
      sql(`INSERT INTO payer_subscribers (payer_id, subscriber_id)
           SELECT before.id, c.id
           FROM seed.client c
           JOIN seed.client prev ON prev.n = c.n - 1
           JOIN seed.payer before ON before.n = c.n - 1
           WHERE c.n BETWEEN ${Math.max(from, 2)} AND ${Math.min(to, plan.clients)}
             AND c.n % 33 = 1 AND NOT c.archived AND NOT prev.archived`),
    ];
  },
};

const phoneOf = (q: Sql, n: string, shift: number, multiplier: number) =>
  `'380' || ${q.word({ shown: PHONE_CODES, norm: PHONE_CODES }, "shown", `${n} + ${shift}`)}
   || lpad((${n}::bigint * ${multiplier} % 10000000)::text, 7, '0')`;

// The first contact of every client is the primary one; the extra ones go to clients across the range. Every fiftieth
// extra contact of a client outside the archive is archived on its own.
const contacts: Step = {
  name: "contacts",
  rows: (plan) => plan.contacts,
  chunk: CHUNK * 2,
  sql: (plan, from, to) => {
    const q = new Sql();
    const name = (form: keyof WordList) =>
      `${q.word(WORDS.surnames, form, "x.k * 7")} || ' ' || ${q.word(WORDS.firstNames, form, "x.k / 11")}`;
    return [
      q.statement(`INSERT INTO contacts (subscriber_id, full_name, full_name_norm, position, phone, phone_rev, phone2,
             phone2_rev, email, channel, is_primary, archived_at, archived_by, archive_batch_id)
           SELECT c.id, ${name("shown")}, ${name("norm")},
             (ARRAY['Директор', 'Бухгалтер', NULL])[1 + x.k % 3],
             '+' || x.phone, reverse(x.phone),
             CASE WHEN x.k % 5 = 0 THEN '+' || x.phone2 END, CASE WHEN x.k % 5 = 0 THEN reverse(x.phone2) END,
             CASE WHEN x.k % 4 = 2 OR x.k % 7 = 0 THEN 'contact' || x.k || '@example.test' END,
             (ARRAY['telegram', 'viber', 'email', NULL])[1 + x.k % 4]::contact_channel,
             x.k <= ${plan.clients},
             CASE WHEN c.archived THEN s.archived_at WHEN b.batch_id IS NOT NULL THEN now() - interval '20 days' END,
             CASE WHEN c.archived THEN s.archived_by WHEN b.batch_id IS NOT NULL THEN s.manager_id END,
             coalesce(c.batch_id, b.batch_id)
           FROM (
             SELECT k, CASE WHEN k <= ${plan.clients} THEN k
                            ELSE ((k - ${plan.clients})::bigint * 104729 % ${plan.clients})::int + 1 END AS client_n,
               ${phoneOf(q, "k", 0, 7919)} AS phone, ${phoneOf(q, "k", 5, 104729)} AS phone2
             FROM generate_series(${from}, ${to}) k
           ) x
           JOIN seed.client c ON c.n = x.client_n
           JOIN subscribers s ON s.id = c.id
           CROSS JOIN LATERAL (
             SELECT CASE WHEN x.k > ${plan.clients} AND x.k % 50 = 0 AND NOT c.archived THEN uuidv7() END AS batch_id
           ) b
           ORDER BY x.k`),
    ];
  },
};

// Each with the client's own payer; signed over almost four years, a year long, so some are active, some expiring and
// some expired, and every 33rd terminated
const contracts: Step = {
  name: "contracts",
  rows: (plan) => plan.contracts,
  chunk: CHUNK * 2,
  sql: (plan, from, to) => [
    sql(`INSERT INTO contracts (subscriber_id, payer_id, number, number_norm, signed_on, valid_until, terminated_on,
           archived_at, archived_by, archive_batch_id)
         SELECT c.id, p.id, 'Д-' || lpad(x.j::text, 7, '0'), 'д-' || lpad(x.j::text, 7, '0'),
           x.signed, x.signed + 365, CASE WHEN x.j % 33 = 0 THEN x.signed + 100 END,
           s.archived_at, s.archived_by, s.archive_batch_id
         FROM (
           SELECT j, (j::bigint * 7919 % ${plan.clients})::int + 1 AS client_n, DATE '2023-01-01' + (j * 37 % 1400) AS signed
           FROM generate_series(${from}, ${to}) j
         ) x
         JOIN seed.client c ON c.n = x.client_n
         JOIN seed.payer p ON p.n = x.client_n
         JOIN subscribers s ON s.id = c.id
         ORDER BY x.j`),
  ],
};

export const CLIENT_STEPS: Step[] = [references, users, series, maps, subscribers, payers, contacts, contracts];
