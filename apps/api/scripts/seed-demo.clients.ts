import { addDays, deriveSubscriberStatus, firstOfNextMonth, normalizeName } from "@gps_crm/shared";
import { contactRow, linkPayer, payerRow } from "./seed-demo.contacts.ts";
import { addContract, viewFirstFile } from "./seed-demo.contracts.ts";
import { CLIENTS, type ClientPlan } from "./seed-demo.data.ts";
import type { Equipment } from "./seed-demo.equipment.ts";
import {
  ARCHIVE_COLUMNS,
  archiveBatch,
  edrpouOf,
  ipnOf,
  must,
  stamps,
  text,
  type Demo,
  type DemoEvent,
  type Moment,
  type Row,
} from "./seed-demo.model.ts";
import {
  addObject,
  archiveObjectAlone,
  archiveObjectRows,
  changeStatus,
  changeTerms,
  ownTariffFrom,
  replaceTracker,
  type ClientRef,
  type ObjectState,
} from "./seed-demo.objects.ts";
import { takeTariff, type Named, type References, type TariffRef } from "./seed-demo.references.ts";

// Clients with their contacts, payers and contracts, then their objects; the changes of the story come after all of them
const SERIES = {
  individuals: { name: "Фізособи", from: 10_000, to: 49_999, types: ["B2C"] },
  companies: { name: "Юрособи", from: 50_000, to: 99_999, types: ["B2B", "B2G"] },
};

interface Client extends ClientRef {
  row: Row;
  plan: ClientPlan;
  objects: ObjectState[];
  contacts: Row[];
  contracts: Row[];
  payerRow: Row;
  sharedPayer: Named | null;
  // The open period of the tariff, which a change of the tariff closes
  tariffPeriod: Row;
}

function seriesOf(type: ClientPlan["type"]) {
  return type === "B2C" ? SERIES.individuals : SERIES.companies;
}

function subscriberRow(
  demo: Demo,
  plan: ClientPlan,
  fields: { code: number; taxId: string | null; managerId: string; since: string; tariff: TariffRef; moment: Moment },
): Row {
  return demo.rows.add("subscribers", {
    id: demo.ids(),
    code: fields.code,
    legacy_code: plan.legacyCode ?? null,
    type: plan.type,
    name: plan.name,
    name_norm: normalizeName(plan.name),
    tax_id: fields.taxId,
    crm_url: `https://crm.example.test/clients/${fields.code}`,
    manager_id: fields.managerId,
    grace_days: plan.graceDays ?? 0,
    discount_kop: plan.discountKop ?? 0,
    program_id: fields.tariff.programId,
    tariff_id: fields.tariff.id,
    tariff_from: fields.since,
    status: "disconnected",
    objects_active: 0,
    objects_suspended: 0,
    objects_disconnected: 0,
    note: plan.note ?? null,
    ...stamps(fields.moment, fields.managerId),
    ...ARCHIVE_COLUMNS,
  });
}

function taxIdOf(plan: ClientPlan, n: number): string | null {
  if (plan.tax === "edrpou") return edrpouOf(n);
  return plan.tax === "ipn" ? ipnOf(n) : null;
}

// «Новий клієнт»: the client, its primary contact and its own payer in one request (subscribers.service.ts)
function createClient(demo: Demo, refs: References, plan: ClientPlan, n: number, code: number): Client {
  const manager = must(demo.managers[n % demo.managers.length], "manager");
  const moment = demo.timeline.next();
  const since = addDays(demo.today, -plan.sinceAgo);
  const tariff = refs.tariff(plan.tariff);
  const taxId = taxIdOf(plan, n);
  const row = subscriberRow(demo, plan, { code, taxId, managerId: manager.id, since, tariff, moment });
  const id = text(row, "id");
  takeTariff(tariff, moment);
  const tariffPeriod = demo.rows.add("subscriber_tariff_periods", {
    id: demo.ids(),
    subscriber_id: id,
    tariff_id: tariff.id,
    valid_from: since,
    valid_to: null,
    created_at: moment,
    created_by: manager.id,
  });
  const at = { moment, actorId: manager.id };
  const primary = contactRow(demo, id, plan, 0, n * 10, at);
  const payer = payerRow(demo, plan, taxId, text(primary, "phone"), n, at);
  linkPayer(demo, text(payer, "id"), id, at);
  const series = seriesOf(plan.type);
  demo.journal.record(
    manager.id,
    [
      {
        action: "subscriber.created",
        entityType: "subscriber",
        entityId: id,
        subscriberId: id,
        details: {
          label: plan.name,
          code,
          series: series.name,
          manager: manager.fullName,
          tariff: tariff.label,
          validFrom: since,
        },
      },
      {
        action: "contact.created",
        entityType: "contact",
        entityId: text(primary, "id"),
        subscriberId: id,
        details: { label: text(primary, "full_name") },
      },
      {
        action: "payer.created",
        entityType: "payer",
        entityId: text(payer, "id"),
        subscriberId: id,
        details: { label: plan.name, paymentMethod: plan.payment },
      },
    ],
    moment,
  );
  const client: Client = {
    id,
    row,
    plan,
    managerId: manager.id,
    sinceAgo: plan.sinceAgo,
    tariff,
    payer: { id: text(payer, "id"), name: plan.name },
    payerRow: payer,
    objects: [],
    contacts: [primary],
    contracts: [],
    sharedPayer: null,
    tariffPeriod,
  };
  return client;
}

function addContacts(demo: Demo, client: Client, n: number): void {
  for (let index = 1; index < client.plan.contacts.length; index++) {
    const moment = demo.timeline.next();
    const contact = contactRow(demo, client.id, client.plan, index, n * 10 + index, {
      moment,
      actorId: client.managerId,
    });
    client.contacts.push(contact);
    demo.journal.record(
      client.managerId,
      [
        {
          action: "contact.created",
          entityType: "contact",
          entityId: text(contact, "id"),
          subscriberId: client.id,
          details: { label: text(contact, "full_name") },
        },
      ],
      moment,
    );
  }
}

// К6: the payer of another client also pays for this one, and signs a contract of its own with it
function sharePayer(demo: Demo, client: Client, owner: Client): void {
  client.sharedPayer = owner.payer;
  demo.later(() => {
    const moment = demo.timeline.next();
    linkPayer(demo, owner.payer.id, client.id, { moment, actorId: client.managerId });
    const event: DemoEvent = {
      action: "payer.linked",
      entityType: "payer",
      entityId: owner.payer.id,
      subscriberId: client.id,
      details: { label: owner.payer.name },
    };
    demo.journal.record(client.managerId, [event], moment);
    for (const plan of client.plan.contracts ?? []) {
      if (plan.isWithSharedPayer) addContract(demo, client, plan, owner.payer);
    }
  });
}

// «Змінити тариф» on the card: a new version from that day, and every object without a tariff of its own follows (D60)
function changeClientTariff(demo: Demo, refs: References, client: Client, key: string, from: string): void {
  demo.later(() => {
    const moment = demo.timeline.next();
    const before = client.tariff;
    const tariff = refs.tariff(key);
    takeTariff(tariff, moment);
    client.tariffPeriod.valid_to = from;
    client.tariffPeriod = demo.rows.add("subscriber_tariff_periods", {
      id: demo.ids(),
      subscriber_id: client.id,
      tariff_id: tariff.id,
      valid_from: from,
      valid_to: null,
      created_at: moment,
      created_by: client.managerId,
    });
    Object.assign(client.row, {
      tariff_id: tariff.id,
      program_id: tariff.programId,
      tariff_from: from,
      updated_at: moment,
    });
    for (const object of client.objects) {
      if (object.row.has_own_tariff !== true) {
        Object.assign(object.row, { tariff_id: tariff.id, program_id: tariff.programId, server_id: tariff.serverId });
      }
    }
    client.tariff = tariff;
    const event: DemoEvent = {
      action: "subscriber.tariff_changed",
      entityType: "subscriber",
      entityId: client.id,
      subscriberId: client.id,
      details: { label: client.plan.name, validFrom: from },
      changes: { tariff: [before.label, tariff.label] },
    };
    demo.journal.record(client.managerId, [event], moment);
  });
}

function itemEvent(action: DemoEvent["action"], entityType: string, row: Row, label: string, subscriberId: string) {
  const event: DemoEvent = { action, entityType, entityId: text(row, "id"), subscriberId, details: { label } };
  return event;
}

// П19: a client with no working objects goes to the archive with its objects, contacts, contracts and own payers
function archiveClient(demo: Demo, client: Client): void {
  demo.later(() => {
    const moment = demo.timeline.next();
    const objects = client.objects.filter((object) => object.row.archived_at === null);
    const count = 1 + client.contacts.length + client.contracts.length + 1 + objects.length;
    const label = `Клієнт: ${client.plan.name}`;
    const batch = archiveBatch(demo, moment, {
      kind: "subscriber",
      label,
      count,
      subscriberId: client.id,
      actorId: client.managerId,
    });
    const archived = {
      archived_at: moment,
      archived_by: client.managerId,
      archive_batch_id: batch.id,
      updated_at: moment,
    };
    for (const object of objects) archiveObjectRows(demo, object, moment, batch.id, client.managerId);
    for (const row of [client.row, ...client.contacts, ...client.contracts, client.payerRow])
      Object.assign(row, archived);
    demo.journal.record(
      client.managerId,
      [
        batch.event,
        itemEvent("subscriber.archived", "subscriber", client.row, client.plan.name, client.id),
        ...objects.map((object) =>
          itemEvent("object.archived", "object", object.row, text(object.row, "name"), client.id),
        ),
        ...client.contacts.map((row) =>
          itemEvent("contact.archived", "contact", row, text(row, "full_name"), client.id),
        ),
        ...client.contracts.map((row) =>
          itemEvent("contract.archived", "contract", row, text(row, "number"), client.id),
        ),
        itemEvent("payer.archived", "payer", client.payerRow, client.plan.name, client.id),
      ],
      moment,
    );
  });
}

function addObjects(demo: Demo, refs: References, eq: Equipment, client: Client, counter: { n: number }): void {
  client.plan.objects.forEach((plan, index) => {
    counter.n += 1;
    const state = addObject(demo, refs, eq, client, plan, index, counter.n);
    client.objects.push(state);
    if (plan.status) changeStatus(demo, refs, state, client, plan.status);
    if (plan.replacedAgo !== undefined) replaceTracker(demo, refs, eq, state, client, plan.replacedAgo);
    if (plan.ownTariff) {
      const tariff = refs.tariff(plan.ownTariff.key);
      changeTerms(demo, state, client, { from: ownTariffFrom(demo, plan.ownTariff.ago), tariff });
    }
    if (plan.sharedPayerAgo !== undefined && client.sharedPayer) {
      changeTerms(demo, state, client, { from: addDays(demo.today, -plan.sharedPayerAgo), payer: client.sharedPayer });
    }
    if (plan.archivedAlone) archiveObjectAlone(demo, state, client);
  });
}

// Counts and status of each client from its live objects, as deriveSubscriberStatus and the job rollup-reconcile count
function rollup(clients: Client[]): void {
  for (const client of clients) {
    const live = client.objects.filter((object) => object.row.archived_at === null).map((object) => object.row.status);
    const counts = {
      objectsActive: live.filter((status) => status === "active").length,
      objectsSuspended: live.filter((status) => status === "suspended").length,
      objectsDisconnected: live.filter((status) => status === "disconnected").length,
    };
    Object.assign(client.row, {
      objects_active: counts.objectsActive,
      objects_suspended: counts.objectsSuspended,
      objects_disconnected: counts.objectsDisconnected,
      status: deriveSubscriberStatus(counts),
    });
  }
}

// The two starting series of the migration (D35), each with its next number past the demo's clients
function addSeries(demo: Demo, next: Map<string, number>): void {
  for (const series of Object.values(SERIES)) {
    const id = demo.ids();
    demo.rows.add("subscriber_id_series", {
      id,
      name: series.name,
      name_norm: normalizeName(series.name),
      range_from: series.from,
      range_to: series.to,
      next_number: must(next.get(series.name), series.name),
    });
    for (const type of series.types) demo.rows.add("subscriber_id_series_types", { type, series_id: id });
  }
}

export function addClients(demo: Demo, refs: References, eq: Equipment): void {
  const next = new Map(Object.values(SERIES).map((series) => [series.name, series.from]));
  const byName = new Map<string, Client>();
  const objects = { n: 0 };
  CLIENTS.forEach((plan, i) => {
    const series = seriesOf(plan.type);
    const code = must(next.get(series.name), series.name);
    next.set(series.name, code + 1);
    const client = createClient(demo, refs, plan, i + 1, code);
    byName.set(plan.name, client);
    addContacts(demo, client, i + 1);
    for (const contract of plan.contracts ?? []) {
      if (!contract.isWithSharedPayer) addContract(demo, client, contract, client.payer);
    }
    if (plan.sharesPayerOf) sharePayer(demo, client, must(byName.get(plan.sharesPayerOf), plan.sharesPayerOf));
    addObjects(demo, refs, eq, client, objects);
    if (plan.pastTariff)
      changeClientTariff(demo, refs, client, plan.pastTariff.key, addDays(demo.today, -plan.pastTariff.ago));
    if (plan.plannedTariff) changeClientTariff(demo, refs, client, plan.plannedTariff, firstOfNextMonth(demo.today));
    if (plan.isArchived) {
      // Its payer goes to the archive with it: the live contracts of a client sharing that payer would point at it
      if (CLIENTS.some((other) => other.sharesPayerOf === plan.name)) {
        throw new Error(`${plan.name}: a client whose payer others share stays out of the archive`);
      }
      archiveClient(demo, client);
    }
  });
  addSeries(demo, next);
  const clients = [...byName.values()];
  demo.later(() =>
    viewFirstFile(
      demo,
      clients.flatMap((client) => client.contracts),
    ),
  );
  demo.later(() => rollup(clients));
}
