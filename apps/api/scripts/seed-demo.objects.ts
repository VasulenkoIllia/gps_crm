import { addDays, firstOfNextMonth, normalizeName } from "@gps_crm/shared";
import type { ObjectPlan } from "./seed-demo.data.ts";
import type { Equipment } from "./seed-demo.equipment.ts";
import {
  ARCHIVE_COLUMNS,
  archiveBatch,
  must,
  stamps,
  text,
  type Demo,
  type DemoEvent,
  type Moment,
  type Row,
} from "./seed-demo.model.ts";
import { takeTariff, type Named, type References, type TariffRef } from "./seed-demo.references.ts";

// Objects with their trackers, SIMs and sensors. A change made later in the story goes through `demo.later`, as a
// person makes it on the card: the rows end as the services would leave them.
const PLATE_REGIONS = ["АА", "ВС", "АІ", "ВО", "ВК", "КА", "АХ", "ВН", "ВІ", "АЕ"];
const PLATE_LETTERS = ["А", "В", "Е", "І", "К", "М", "Н", "О", "Р", "С", "Т", "Х"];
// The objects of a client are connected one after another, this many days apart
const OBJECT_SPACING_DAYS = 23;
const LATEST_CONNECTION_AGO = 10;
const SENSOR_AFTER_DAYS = 10;

export interface ClientRef {
  id: string;
  managerId: string;
  sinceAgo: number;
  tariff: TariffRef;
  payer: Named;
}

export interface ObjectState {
  row: Row;
  device: Row;
  sim: Row;
  deviceInstall: Row;
  simInstall: Row;
  sensorInstalls: Row[];
  status: Row;
  terms: Row;
}

function plateOf(n: number): string {
  const letter = (i: number) => must(PLATE_LETTERS[i % PLATE_LETTERS.length], "letter");
  const region = must(PLATE_REGIONS[n % PLATE_REGIONS.length], "region");
  return `${region} ${String(1_000 + ((n * 397) % 9_000))} ${letter(n * 5 + 3)}${letter(n * 7 + 1)}`;
}

function period(demo: Demo, table: string, moment: Moment, actorId: string, fields: Row): Row {
  return demo.rows.add(table, { id: demo.ids(), ...fields, created_at: moment, created_by: actorId });
}

interface Installing {
  object: Row;
  moment: Moment;
  client: ClientRef;
  connected: string;
  contractor: Named;
  events: DemoEvent[];
}

function addSensors(demo: Demo, eq: Equipment, at: Installing, count: number): Row[] {
  const on = addDays(at.connected, SENSOR_AFTER_DAYS);
  return Array.from({ length: count }, () => {
    const sensor = eq.sensor(at.moment, at.client.managerId);
    const details = { serialNo: text(sensor, "serial_no"), installedOn: on };
    at.events.push(objectEvent("sensor.installed", at.object, at.client.id, details));
    return period(demo, "sensor_installations", at.moment, at.client.managerId, {
      object_id: at.object.id,
      sensor_id: sensor.id,
      valid_from: on,
      valid_to: null,
      contractor_id: at.contractor.id,
    });
  });
}

function objectEvent(
  action: DemoEvent["action"],
  object: Row,
  subscriberId: string,
  details: DemoEvent["details"] = {},
  changes?: DemoEvent["changes"],
): DemoEvent {
  return {
    action,
    entityType: "object",
    entityId: text(object, "id"),
    subscriberId,
    details: { label: text(object, "name"), ...details },
    changes,
  };
}

function objectRow(demo: Demo, client: ClientRef, plan: ObjectPlan, n: number, connected: string, moment: Moment): Row {
  const name = `${plan.vehicle} ${plateOf(n)}`;
  return demo.rows.add("objects", {
    id: demo.ids(),
    subscriber_id: client.id,
    name,
    name_norm: normalizeName(name),
    status: "active",
    status_from: connected,
    connected_on: connected,
    disconnected_on: null,
    disconnect_reason_id: null,
    payer_id: client.payer.id,
    tariff_id: client.tariff.id,
    program_id: client.tariff.programId,
    server_id: client.tariff.serverId,
    has_own_tariff: false,
    tariff_from: connected,
    current_device_id: null,
    note: null,
    ...stamps(moment, client.managerId),
    ...ARCHIVE_COLUMNS,
  });
}

// «Новий об'єкт» with a tracker, its SIM, services and sensors in one request, as objects.service.ts records it
export function addObject(
  demo: Demo,
  refs: References,
  eq: Equipment,
  client: ClientRef,
  plan: ObjectPlan,
  index: number,
  n: number,
) {
  const connectedAgo = Math.max(client.sinceAgo - index * OBJECT_SPACING_DAYS, LATEST_CONNECTION_AGO);
  const connected = addDays(demo.today, -connectedAgo);
  const actorId = client.managerId;
  const moment = demo.timeline.next();
  const contractor = must(refs.contractors[n % refs.contractors.length], "contractor");
  const row = objectRow(demo, client, plan, n, connected, moment);
  const device = eq.device(plan.model, "installed", moment, actorId);
  const sim = eq.sim("active", moment, actorId);
  device.current_sim_id = sim.id;
  row.current_device_id = device.id;
  takeTariff(client.tariff, moment);
  const where = { installedOn: connected, contractor: contractor.name };
  const addons = (plan.addons ?? []).map((key) => refs.addon(key));
  const events: DemoEvent[] = [
    objectEvent("object.created", row, client.id, {
      status: "active",
      statusFrom: connected,
      connectedOn: connected,
      tariff: client.tariff.label,
      payer: client.payer.name,
      ...(addons.length > 0 ? { addon: addons.map((addon) => addon.name).join(", ") } : {}),
    }),
    objectEvent("device.installed", row, client.id, { imei: text(device, "imei"), ...where }),
    objectEvent("sim.installed", row, client.id, { iccid: text(sim, "iccid"), ...where }),
  ];
  for (const addon of addons) {
    period(demo, "object_addon_periods", moment, actorId, {
      object_id: row.id,
      addon_id: addon.id,
      valid_from: connected,
      valid_to: null,
    });
  }
  const state: ObjectState = {
    row,
    device,
    sim,
    deviceInstall: period(demo, "device_installations", moment, actorId, {
      object_id: row.id,
      device_id: device.id,
      valid_from: connected,
      valid_to: null,
      contractor_id: contractor.id,
    }),
    simInstall: period(demo, "sim_installations", moment, actorId, {
      device_id: device.id,
      sim_id: sim.id,
      valid_from: connected,
      valid_to: null,
      contractor_id: contractor.id,
    }),
    sensorInstalls: addSensors(
      demo,
      eq,
      { object: row, moment, client, connected, contractor, events },
      plan.sensors ?? 0,
    ),
    status: period(demo, "object_status_periods", moment, actorId, {
      object_id: row.id,
      status: "active",
      valid_from: connected,
      valid_to: null,
      reason_id: null,
      note: null,
    }),
    terms: period(demo, "object_service_terms", moment, actorId, {
      object_id: row.id,
      payer_id: client.payer.id,
      own_tariff_id: null,
      valid_from: connected,
      valid_to: null,
    }),
  };
  demo.journal.record(actorId, events, moment);
  return state;
}

export function changeStatus(
  demo: Demo,
  refs: References,
  state: ObjectState,
  client: ClientRef,
  change: NonNullable<ObjectPlan["status"]>,
) {
  demo.later(() => {
    const moment = demo.timeline.next();
    const from = addDays(demo.today, -change.ago);
    const reason = change.reason ? refs.reason(change.reason) : null;
    state.status.valid_to = from;
    state.status = period(demo, "object_status_periods", moment, client.managerId, {
      object_id: state.row.id,
      status: change.to,
      valid_from: from,
      valid_to: null,
      reason_id: reason?.id ?? null,
      note: null,
    });
    Object.assign(state.row, { status: change.to, status_from: from, updated_at: moment });
    if (change.to === "disconnected")
      Object.assign(state.row, { disconnected_on: from, disconnect_reason_id: reason?.id ?? null });
    if (change.reason === "nonpay") state.sim.status = "blocked";
    const details = { validFrom: from, ...(reason ? { reason: reason.name } : {}) };
    const event = objectEvent("object.status_changed", state.row, client.id, details, {
      status: ["active", change.to],
    });
    demo.journal.record(client.managerId, [event], moment);
  });
}

// «Змінити тариф» or a new payer on the object: a new version of the terms from that day (D70)
export function changeTerms(
  demo: Demo,
  state: ObjectState,
  client: ClientRef,
  change: { from: string; tariff?: TariffRef; payer?: Named },
) {
  demo.later(() => {
    const moment = demo.timeline.next();
    // What the change leaves alone goes on as it was in the version before
    const previous = state.terms;
    previous.valid_to = change.from;
    state.terms = period(demo, "object_service_terms", moment, client.managerId, {
      object_id: state.row.id,
      payer_id: change.payer?.id ?? previous.payer_id,
      own_tariff_id: change.tariff?.id ?? previous.own_tariff_id,
      valid_from: change.from,
      valid_to: null,
    });
    const changes: DemoEvent["changes"] = {};
    if (change.tariff) {
      takeTariff(change.tariff, moment);
      changes.tariff = [client.tariff.label, change.tariff.label];
      Object.assign(state.row, {
        tariff_id: change.tariff.id,
        program_id: change.tariff.programId,
        server_id: change.tariff.serverId,
        has_own_tariff: true,
        tariff_from: change.from,
      });
    }
    if (change.payer) {
      changes.payer = [client.payer.name, change.payer.name];
      state.row.payer_id = change.payer.id;
    }
    state.row.updated_at = moment;
    const event = objectEvent("object.terms_changed", state.row, client.id, { validFrom: change.from }, changes);
    demo.journal.record(client.managerId, [event], moment);
  });
}

export function ownTariffFrom(demo: Demo, ago: number | "next month"): string {
  return ago === "next month" ? firstOfNextMonth(demo.today) : addDays(demo.today, -ago);
}

// «Замінити трекер»: the old one goes to stock, the SIM moves into the new one
export function replaceTracker(
  demo: Demo,
  refs: References,
  eq: Equipment,
  state: ObjectState,
  client: ClientRef,
  ago: number,
) {
  demo.later(() => {
    const moment = demo.timeline.next();
    const on = addDays(demo.today, -ago);
    const contractor = must(refs.contractors[0], "contractor");
    const old = state.device;
    const model = refs.models.findIndex((row) => row.id === old.model_id);
    const device = eq.device(model, "installed", moment, client.managerId);
    Object.assign(old, { status: "removed", current_sim_id: null, updated_at: moment });
    device.current_sim_id = state.sim.id;
    state.deviceInstall.valid_to = on;
    state.simInstall.valid_to = on;
    const installation = { valid_from: on, valid_to: null, contractor_id: contractor.id };
    state.deviceInstall = period(demo, "device_installations", moment, client.managerId, {
      object_id: state.row.id,
      device_id: device.id,
      ...installation,
    });
    state.simInstall = period(demo, "sim_installations", moment, client.managerId, {
      device_id: device.id,
      sim_id: state.sim.id,
      ...installation,
    });
    state.device = device;
    Object.assign(state.row, { current_device_id: device.id, updated_at: moment });
    const details = { installedOn: on, contractor: contractor.name, oldTrackerState: "removed" };
    const event = objectEvent("device.replaced", state.row, client.id, details, {
      imei: [text(old, "imei"), text(device, "imei")],
    });
    demo.journal.record(client.managerId, [event], moment);
  });
}

// D71: the archive closes the installations on its own day, the tracker goes to stock and the SIM is free
export function archiveObjectRows(
  demo: Demo,
  state: ObjectState,
  moment: Moment,
  batchId: string,
  actorId: string,
): void {
  const day = demo.timeline.dayOf(moment);
  for (const installation of [state.deviceInstall, state.simInstall, ...state.sensorInstalls]) {
    if (installation.valid_to === null) installation.valid_to = day;
  }
  Object.assign(state.device, { status: "removed", current_sim_id: null, updated_at: moment });
  if (state.sim.status === "active") Object.assign(state.sim, { status: "free", updated_at: moment });
  Object.assign(state.row, {
    current_device_id: null,
    archived_at: moment,
    archived_by: actorId,
    archive_batch_id: batchId,
    updated_at: moment,
  });
}

export function archiveObjectAlone(demo: Demo, state: ObjectState, client: ClientRef) {
  demo.later(() => {
    const moment = demo.timeline.next();
    const label = `Об'єкт: ${text(state.row, "name")}`;
    const batch = archiveBatch(demo, moment, {
      kind: "object",
      label,
      count: 1,
      subscriberId: client.id,
      actorId: client.managerId,
    });
    archiveObjectRows(demo, state, moment, batch.id, client.managerId);
    const item: DemoEvent = {
      action: "object.archived",
      entityType: "object",
      entityId: text(state.row, "id"),
      subscriberId: client.id,
      details: { label: text(state.row, "name") },
    };
    demo.journal.record(client.managerId, [batch.event, item], moment);
  });
}
