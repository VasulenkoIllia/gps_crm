import { firstOfNextMonth, normalizeName, REFERENCE_ENTITY_TYPES } from "@gps_crm/shared";
import { must, stamps, type Demo, type DemoEvent, type Moment, type Row } from "./seed-demo.model.ts";

// The reference lists of the demo. Names and prices come from the public demo (tag `demo`, D37): nothing here is the
// client's.
const PRICES_FROM = "2025-01-01";

const PROGRAMS = ["Unitrack", "Forguard", "Ruhavik"];

const SERVERS = [
  { key: "u1", program: "Unitrack", name: "Сервер 1", url: "https://unitrack-1.example.test", costKop: 4_500 },
  { key: "u2", program: "Unitrack", name: "Сервер 2", url: "https://unitrack-2.example.test", costKop: 5_000 },
  { key: "fg", program: "Forguard", name: "Основний", url: "https://forguard.example.test", costKop: 6_000 },
  { key: "rh", program: "Ruhavik", name: "Cloud", url: "https://ruhavik.example.test", costKop: 3_000 },
];

const TARIFFS = [
  { key: "u1StartM", server: "u1", name: "Start", billing: "month", priceKop: 16_000 },
  { key: "u1StartY", server: "u1", name: "Start", billing: "year", priceKop: 172_800 },
  { key: "u1ProM", server: "u1", name: "Pro", billing: "month", priceKop: 22_000 },
  { key: "u1ProY", server: "u1", name: "Pro", billing: "year", priceKop: 237_600 },
  { key: "u2StartM", server: "u2", name: "Start", billing: "month", priceKop: 16_000 },
  { key: "u2ProM", server: "u2", name: "Pro", billing: "month", priceKop: 22_000 },
  { key: "fgBaseM", server: "fg", name: "Базовий", billing: "month", priceKop: 25_000 },
  { key: "fgBaseY", server: "fg", name: "Базовий", billing: "year", priceKop: 228_000 },
  { key: "fgPremM", server: "fg", name: "Преміум", billing: "month", priceKop: 39_000 },
  { key: "fgPremY", server: "fg", name: "Преміум", billing: "year", priceKop: 348_000 },
  { key: "rhSimY", server: "rh", name: "SIM 12 міс", billing: "year", priceKop: 96_000 },
];

// «Нова версія тарифу» (D88): made later in the story, two clients move to it from the 1st of next month
const TARIFF_VERSION = { key: "u1Start2027M", basedOn: "u1StartM", name: "Start 2027", priceKop: 18_000 };

const ADDONS = [
  { key: "roaming", name: "Роумінг", priceKop: 15_000, costKop: null },
  { key: "sent", name: "SENT / e-TOLL", priceKop: 33_000, costKop: 20_000 },
  { key: "agro", name: "Агроконтроль", priceKop: 15_000, costKop: null },
];
// D87: a price that starts later, which the list shows with its date and which can still be cancelled
const PLANNED_ADDON_PRICE = { addon: "roaming", priceKop: 17_000 };
const PLANNED_SERVER_COST = { server: "fg", costKop: 6_500 };

const MODELS = [
  "Teltonika FMB920",
  "Teltonika FMB125",
  "Teltonika FMC130",
  "Teltonika FMB140",
  "Ruptela FM-Eco4 light+",
  "Queclink GV300",
];
const OPERATORS = ["Vodafone", "Київстар"];
const SIM_PLANS = [
  { operator: "Vodafone", name: "M2M Базовий", costKop: 4_000 },
  { operator: "Vodafone", name: "M2M Роумінг", costKop: 14_000 },
  { operator: "Київстар", name: "M2M", costKop: 4_500 },
];
const CONTRACTORS = ["Власна монтажна бригада", "ФОП Гуменюк (монтаж)", "Автоелектрик Сервіс"];
const REASONS = {
  sold: "Продаж транспорту",
  competitor: "Перехід до іншого постачальника",
  closed: "Припинення діяльності",
  nonpay: "Несплата",
  season: "Сезонне зняття з обслуговування",
  other: "Інше",
} as const;
export type ReasonKey = keyof typeof REASONS;

export interface TariffRef {
  id: string;
  programId: string;
  serverId: string;
  name: string;
  serverName: string;
  // As the journal names a tariff: «Start (Сервер 1)»
  label: string;
  row: Row;
}

export interface Named {
  id: string;
  name: string;
}

export interface References {
  tariff: (key: string) => TariffRef;
  addon: (key: string) => Named;
  reason: (key: ReasonKey) => Named;
  models: Named[];
  sims: { operatorId: string; planId: string }[];
  contractors: Named[];
}

type Kind = keyof typeof REFERENCE_ENTITY_TYPES;

function created(kind: Kind, id: string, name: string, details: DemoEvent["details"] = {}): DemoEvent {
  return {
    action: "reference.created",
    entityType: REFERENCE_ENTITY_TYPES[kind],
    entityId: id,
    details: { label: name, ...details },
  };
}

function costAdded(kind: Kind, id: string, name: string, costKop: number, validFrom: string): DemoEvent {
  return {
    action: "reference.cost_added",
    entityType: REFERENCE_ENTITY_TYPES[kind],
    entityId: id,
    details: { label: name, costKop, validFrom },
  };
}

function addCost(
  demo: Demo,
  moment: Moment,
  subject: "server" | "sim_plan" | "addon",
  id: string,
  kop: number,
  from: string,
) {
  demo.rows.add("cost_prices", {
    id: demo.ids(),
    subject_type: subject,
    subject_id: id,
    cost_kop: kop,
    valid_from: from,
    created_at: moment,
    created_by: demo.admin.id,
  });
}

// A simple list: a name, an order, and a line «Новий запис довідника»
function addSimple(demo: Demo, table: string, kind: Kind, names: string[]): Named[] {
  return names.map((name, i) => {
    const id = demo.ids();
    const moment = demo.journal.record(demo.admin.id, [created(kind, id, name)]);
    demo.rows.add(table, {
      id,
      name,
      name_norm: normalizeName(name),
      sort_order: i + 1,
      ...stamps(moment, demo.admin.id),
    });
    return { id, name };
  });
}

function addServers(demo: Demo, programs: Map<string, string>) {
  const servers = new Map<string, { id: string; programId: string; name: string }>();
  for (const server of SERVERS) {
    const id = demo.ids();
    const programId = must(programs.get(server.program), server.program);
    const moment = demo.journal.record(demo.admin.id, [
      created("servers", id, server.name, { program: server.program, url: server.url }),
      costAdded("servers", id, server.name, server.costKop, PRICES_FROM),
    ]);
    demo.rows.add("monitoring_servers", {
      id,
      program_id: programId,
      name: server.name,
      name_norm: normalizeName(server.name),
      url: server.url,
      ...stamps(moment, demo.admin.id),
    });
    addCost(demo, moment, "server", id, server.costKop, PRICES_FROM);
    servers.set(server.key, { id, programId, name: server.name });
  }
  return servers;
}

function tariffRow(demo: Demo, moment: Moment, ref: Omit<TariffRef, "label" | "row">, billing: string, kop: number) {
  return demo.rows.add("tariffs", {
    id: ref.id,
    program_id: ref.programId,
    server_id: ref.serverId,
    name: ref.name,
    name_norm: normalizeName(ref.name),
    billing_model: billing,
    price_kop: kop,
    selected_at: null,
    based_on_id: null,
    ...stamps(moment, demo.admin.id),
  });
}

function addTariffs(demo: Demo, servers: ReturnType<typeof addServers>, programNames: Map<string, string>) {
  const tariffs = new Map<string, TariffRef>();
  for (const tariff of TARIFFS) {
    const server = must(servers.get(tariff.server), tariff.server);
    const ref = {
      id: demo.ids(),
      programId: server.programId,
      serverId: server.id,
      name: tariff.name,
      serverName: server.name,
    };
    const moment = demo.journal.record(demo.admin.id, [
      created("tariffs", ref.id, tariff.name, {
        program: must(programNames.get(server.programId), server.programId),
        server: server.name,
        billingModel: tariff.billing,
        priceKop: tariff.priceKop,
      }),
    ]);
    const row = tariffRow(demo, moment, ref, tariff.billing, tariff.priceKop);
    tariffs.set(tariff.key, { ...ref, label: `${tariff.name} (${server.name})`, row });
  }
  return tariffs;
}

function addAddons(demo: Demo, unitrackId: string) {
  const addons = new Map<string, Named>();
  for (const addon of ADDONS) {
    const id = demo.ids();
    const events = [
      created("addons", id, addon.name, { programs: "Unitrack", priceKop: addon.priceKop, validFrom: PRICES_FROM }),
    ];
    if (addon.costKop) events.push(costAdded("addons", id, addon.name, addon.costKop, PRICES_FROM));
    const moment = demo.journal.record(demo.admin.id, events);
    demo.rows.add("addons", {
      id,
      name: addon.name,
      name_norm: normalizeName(addon.name),
      ...stamps(moment, demo.admin.id),
    });
    demo.rows.add("addon_prices", {
      id: demo.ids(),
      addon_id: id,
      price_kop: addon.priceKop,
      valid_from: PRICES_FROM,
      created_at: moment,
      created_by: demo.admin.id,
    });
    demo.rows.add("addon_programs", { addon_id: id, program_id: unitrackId });
    if (addon.costKop) addCost(demo, moment, "addon", id, addon.costKop, PRICES_FROM);
    addons.set(addon.key, { id, name: addon.name });
  }
  return addons;
}

function addSimPlans(demo: Demo, operators: Named[]) {
  return SIM_PLANS.map((plan, i) => {
    const id = demo.ids();
    const operator = must(
      operators.find((row) => row.name === plan.operator),
      plan.operator,
    );
    const moment = demo.journal.record(demo.admin.id, [
      created("sim-plans", id, plan.name, { operator: operator.name }),
      costAdded("sim-plans", id, plan.name, plan.costKop, PRICES_FROM),
    ]);
    demo.rows.add("sim_plans", {
      id,
      operator_id: operator.id,
      name: plan.name,
      name_norm: normalizeName(plan.name),
      sort_order: i + 1,
      ...stamps(moment, demo.admin.id),
    });
    addCost(demo, moment, "sim_plan", id, plan.costKop, PRICES_FROM);
    return { operatorId: operator.id, planId: id };
  });
}

// Recorded after the clients: a new version of a tariff, then a price and a cost that start on the 1st of next month
function addLaterChanges(
  demo: Demo,
  tariffs: Map<string, TariffRef>,
  addons: Map<string, Named>,
  servers: ReturnType<typeof addServers>,
) {
  const from = firstOfNextMonth(demo.today);
  const base = must(tariffs.get(TARIFF_VERSION.basedOn), TARIFF_VERSION.basedOn);
  const ref = {
    id: demo.ids(),
    programId: base.programId,
    serverId: base.serverId,
    name: TARIFF_VERSION.name,
    serverName: base.serverName,
  };
  tariffs.set(TARIFF_VERSION.key, { ...ref, label: `${ref.name} (${ref.serverName})`, row: {} });
  demo.later(() => {
    const moment = demo.journal.record(demo.admin.id, [
      {
        action: "reference.tariff_version_created",
        entityType: REFERENCE_ENTITY_TYPES.tariffs,
        entityId: ref.id,
        details: { label: ref.name, basedOn: base.name, priceKop: TARIFF_VERSION.priceKop },
      },
    ]);
    const row = tariffRow(demo, moment, ref, "month", TARIFF_VERSION.priceKop);
    row.based_on_id = base.id;
    must(tariffs.get(TARIFF_VERSION.key), TARIFF_VERSION.key).row = row;
  });
  demo.later(() => {
    const addon = must(addons.get(PLANNED_ADDON_PRICE.addon), PLANNED_ADDON_PRICE.addon);
    const event: DemoEvent = {
      action: "reference.price_added",
      entityType: REFERENCE_ENTITY_TYPES.addons,
      entityId: addon.id,
      details: { label: addon.name, priceKop: PLANNED_ADDON_PRICE.priceKop, validFrom: from },
    };
    const moment = demo.journal.record(demo.admin.id, [event]);
    demo.rows.add("addon_prices", {
      id: demo.ids(),
      addon_id: addon.id,
      price_kop: PLANNED_ADDON_PRICE.priceKop,
      valid_from: from,
      created_at: moment,
      created_by: demo.admin.id,
    });
  });
  demo.later(() => {
    const server = must(servers.get(PLANNED_SERVER_COST.server), PLANNED_SERVER_COST.server);
    const moment = demo.journal.record(demo.admin.id, [
      costAdded("servers", server.id, server.name, PLANNED_SERVER_COST.costKop, from),
    ]);
    addCost(demo, moment, "server", server.id, PLANNED_SERVER_COST.costKop, from);
  });
}

export function addReferences(demo: Demo): References {
  const programs = addSimple(demo, "programs", "programs", PROGRAMS);
  const programIds = new Map(programs.map((program) => [program.name, program.id]));
  const programNames = new Map(programs.map((program) => [program.id, program.name]));
  const servers = addServers(demo, programIds);
  const tariffs = addTariffs(demo, servers, programNames);
  const addons = addAddons(demo, must(programIds.get("Unitrack"), "Unitrack"));
  const models = addSimple(demo, "tracker_models", "tracker-models", MODELS);
  const operators = addSimple(demo, "sim_operators", "sim-operators", OPERATORS);
  const sims = addSimPlans(demo, operators);
  const contractors = addSimple(demo, "contractors", "contractors", CONTRACTORS);
  const reasons = addSimple(demo, "disconnect_reasons", "disconnect-reasons", Object.values(REASONS));
  addLaterChanges(demo, tariffs, addons, servers);
  return {
    tariff: (key) => must(tariffs.get(key), `tariff ${key}`),
    addon: (key) => must(addons.get(key), `addon ${key}`),
    reason: (key) =>
      must(
        reasons.find((reason) => reason.name === REASONS[key]),
        `reason ${key}`,
      ),
    models,
    sims,
    contractors,
  };
}

// П9 of references.md: the first client or object that takes a tariff fixes its price
export function takeTariff(tariff: TariffRef, moment: Moment): void {
  if (tariff.row.selected_at === null || tariff.row.selected_at === undefined) tariff.row.selected_at = moment;
}
