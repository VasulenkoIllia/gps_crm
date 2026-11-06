import { normalizeName, reverseDigits } from "@gps_crm/shared";
import { STOCK } from "./seed-demo.data.ts";
import {
  ARCHIVE_COLUMNS,
  archiveBatch,
  iccidOf,
  imeiOf,
  mobileOf,
  must,
  stamps,
  text,
  type Demo,
  type DemoEvent,
  type Moment,
  type Row,
} from "./seed-demo.model.ts";
import type { References } from "./seed-demo.references.ts";

// Trackers, SIMs and sensors, numbered in the order they are made so that no two share a number, and the equipment on
// no object: in stock, in repair, written off into the archive
const SIM_CODES = ["67", "50", "97", "63", "66", "73", "93", "95", "99"];
const MSISDN_SHIFT = 500;
const RENTED_EVERY = 4;
const SENSOR_SERIAL_FROM = 2_000;

export interface Equipment {
  device: (model: number, status: string, moment: Moment, actorId: string) => Row;
  sim: (status: string, moment: Moment, actorId: string) => Row;
  sensor: (moment: Moment, actorId: string) => Row;
}

export function makeEquipment(demo: Demo, refs: References): Equipment {
  let devices = 0;
  let sims = 0;
  let sensors = 0;
  return {
    device: (model, status, moment, actorId) => {
      devices += 1;
      const imei = imeiOf(devices);
      return demo.rows.add("devices", {
        id: demo.ids(),
        imei,
        imei_rev: reverseDigits(imei),
        model_id: must(refs.models[model], `model ${model}`).id,
        status,
        ownership: devices % RENTED_EVERY === 0 ? "rented" : "sold",
        current_sim_id: null,
        note: null,
        ...stamps(moment, actorId),
        ...ARCHIVE_COLUMNS,
      });
    },
    sim: (status, moment, actorId) => {
      sims += 1;
      const iccid = iccidOf(sims);
      const msisdn = mobileOf(must(SIM_CODES[sims % SIM_CODES.length], "code"), sims + MSISDN_SHIFT);
      const plan = must(refs.sims[sims % refs.sims.length], "SIM plan");
      return demo.rows.add("sims", {
        id: demo.ids(),
        iccid,
        iccid_rev: reverseDigits(iccid),
        msisdn,
        msisdn_rev: reverseDigits(msisdn),
        operator_id: plan.operatorId,
        plan_id: plan.planId,
        status,
        note: null,
        ...stamps(moment, actorId),
        ...ARCHIVE_COLUMNS,
      });
    },
    sensor: (moment, actorId) => {
      sensors += 1;
      const serial = `ДУТ-${SENSOR_SERIAL_FROM + sensors * 37}`;
      return demo.rows.add("sensors", {
        id: demo.ids(),
        serial_no: serial,
        serial_no_norm: normalizeName(serial),
        note: null,
        ...stamps(moment, actorId),
        ...ARCHIVE_COLUMNS,
      });
    },
  };
}

type Kind = "device" | "sim" | "sensor";
const LABEL_COLUMN: Record<Kind, string> = { device: "imei", sim: "iccid", sensor: "serial_no" };

// «Новий трекер», «Нова SIM», «Новий датчик» (equipment.service.ts)
function recordCreated(demo: Demo, kind: Kind, make: (moment: Moment) => Row): Row {
  const moment = demo.timeline.next();
  const row = make(moment);
  const event: DemoEvent = {
    action: `${kind}.created`,
    entityType: kind,
    entityId: text(row, "id"),
    details: { label: text(row, LABEL_COLUMN[kind]) },
  };
  demo.journal.record(demo.admin.id, [event], moment);
  return row;
}

function archiveDevice(demo: Demo, row: Row): void {
  demo.later(() => {
    const moment = demo.timeline.next();
    const label = text(row, "imei");
    const batch = archiveBatch(demo, moment, {
      kind: "device",
      label: `Трекер: ${label}`,
      count: 1,
      subscriberId: null,
      actorId: demo.admin.id,
    });
    Object.assign(row, {
      archived_at: moment,
      archived_by: demo.admin.id,
      archive_batch_id: batch.id,
      updated_at: moment,
    });
    const item: DemoEvent = {
      action: "device.archived",
      entityType: "device",
      entityId: text(row, "id"),
      details: { label },
    };
    demo.journal.record(demo.admin.id, [batch.event, item], moment);
  });
}

// The warehouse before the clients
export function addStock(demo: Demo, eq: Equipment): void {
  const actorId = demo.admin.id;
  const device = (model: number, status: string) =>
    recordCreated(demo, "device", (moment) => eq.device(model, status, moment, actorId));
  STOCK.devices.forEach((model) => device(model, "removed"));
  STOCK.repair.forEach((model) => device(model, "repair"));
  const writtenOff = STOCK.writtenOff.map((model) => device(model, "written_off"));
  const sim = (status: string) => recordCreated(demo, "sim", (moment) => eq.sim(status, moment, actorId));
  for (let i = 0; i < STOCK.freeSims; i++) sim("free");
  for (let i = 0; i < STOCK.blockedSims; i++) sim("blocked");
  for (let i = 0; i < STOCK.sensors; i++) recordCreated(demo, "sensor", (moment) => eq.sensor(moment, actorId));
  for (const row of writtenOff) archiveDevice(demo, row);
}
