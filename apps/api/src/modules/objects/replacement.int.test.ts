import { dateText, type DeviceCard, type SimCard, type SubscriberListItem } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import {
  createReason,
  MONTH_AGO,
  nextIccid,
  nextImei,
  resetObjects,
  startObjectApi,
  TODAY,
  WEEK_AGO,
  YESTERDAY,
  type ObjectApi,
} from "../../test-objects.js";
import { items } from "../../test-references.js";

describe("equipment on an object, the archive and the delete", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ObjectApi;

  const deviceCard = async (id: string) => (await client.call("GET", `/devices/${id}`)).json<DeviceCard>();
  const simCard = async (id: string) => (await client.call("GET", `/sims/${id}`)).json<SimCard>();

  async function registerDevice(): Promise<string> {
    return (await client.call("POST", "/devices", { imei: nextImei() })).json<{ id: string }>().id;
  }

  async function registerSim(): Promise<string> {
    return (await client.call("POST", "/sims", { iccid: nextIccid() })).json<{ id: string }>().id;
  }

  async function disconnect(id: string, validFrom = TODAY): Promise<void> {
    const reasonId = await createReason(client, `Причина ${id}`);
    await client.call("POST", `/objects/${id}/status`, { status: "disconnected", validFrom, reasonId });
  }

  async function archived(fields: object = {}): Promise<string> {
    const id = await client.createObject(fields);
    await disconnect(id);
    await client.call("POST", `/objects/${id}/archive`, {});
    return id;
  }

  beforeAll(async () => {
    client = await startObjectApi(db, owner);
  });

  beforeEach(async () => {
    await resetObjects(client, owner);
  });

  afterAll(async () => {
    await client.app.close();
    await db.$disconnect();
    await owner.$disconnect();
  });

  describe("a replacement of the tracker", () => {
    it("closes the old one and opens the new on one date, and the SIM goes across", async () => {
      const oldId = await registerDevice();
      const simId = await registerSim();
      const id = await client.createObject({ device: { deviceId: oldId }, sim: { simId } });
      const contractorId = await client.create("/contractors", { name: "Підрядник 1" });
      const imei = nextImei();

      const response = await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei },
        installedOn: WEEK_AGO,
        contractorId,
        oldState: "repair",
        moveSim: true,
      });

      expect(response.statusCode).toBe(204);
      expect(await client.objectCard(id)).toMatchObject({
        device: { imei, installedOn: WEEK_AGO, contractorName: "Підрядник 1" },
        sim: { id: simId, installedOn: WEEK_AGO },
      });
      expect(await deviceCard(oldId)).toMatchObject({ status: "repair", place: null });
      expect((await simCard(simId)).status).toBe("active");
    });

    it("keeps the history and the terms of the object", async () => {
      const oldImei = nextImei();
      const id = await client.createObject({ device: { imei: oldImei } });
      const before = await client.objectCard(id);
      const imei = nextImei();

      await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei },
        installedOn: WEEK_AGO,
        moveSim: true,
      });

      const after = await client.objectCard(id);
      const history = await client.history(id);
      expect(after).toMatchObject({
        id: before.id,
        status: before.status,
        statusFrom: before.statusFrom,
        connectedOn: before.connectedOn,
        tariff: before.tariff,
        payerId: before.payerId,
      });
      expect(history.statuses).toHaveLength(1);
      expect(history.terms).toHaveLength(1);
      expect(history.devices).toMatchObject([
        { imei, validFrom: WEEK_AGO, validTo: null },
        { imei: oldImei, validFrom: MONTH_AGO, validTo: WEEK_AGO },
      ]);
      expect(history.sims).toHaveLength(2);
      expect(await client.journal("device.replaced")).toMatchObject([
        { entityType: "object", entityId: id, changes: [{ field: "imei", before: oldImei, after: imei }] },
      ]);
    });

    it("lets the old SIM go when a new one is chosen", async () => {
      const oldSim = await registerSim();
      const id = await client.createObject({ sim: { simId: oldSim } });
      const newSim = await registerSim();

      await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: YESTERDAY,
        moveSim: false,
        sim: { simId: newSim },
      });

      expect(await simCard(oldSim)).toMatchObject({ status: "free", deviceImei: null });
      expect(await simCard(newSim)).toMatchObject({ status: "active" });
      expect((await client.objectCard(id)).sim?.id).toBe(newSim);
      expect(await client.journal("sim.replaced")).toHaveLength(1);
    });

    it("leaves everything as it was when the new tracker is taken", async () => {
      const oldId = await registerDevice();
      const id = await client.createObject({ device: { deviceId: oldId } });
      const imei = nextImei();
      await client.createObject({ name: "Інший", device: { imei } });

      const response = await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei },
        installedOn: TODAY,
        moveSim: true,
      });

      expect(response.statusCode).toBe(409);
      expect((await client.objectCard(id)).device?.id).toBe(oldId);
      expect((await deviceCard(oldId)).status).toBe("installed");
      expect((await client.history(id)).devices).toHaveLength(1);
    });

    it("rolls the tracker back when the SIM fails after it", async () => {
      const oldId = await registerDevice();
      const id = await client.createObject({ device: { deviceId: oldId } });
      const iccid = nextIccid();
      await client.createObject({ name: "Інший", sim: { iccid } });
      const newId = await registerDevice();

      const response = await client.call("POST", `/objects/${id}/replace-device`, {
        device: { deviceId: newId },
        installedOn: TODAY,
        moveSim: false,
        sim: { iccid },
      });

      expect(response.statusCode).toBe(409);
      expect((await client.objectCard(id)).device?.id).toBe(oldId);
      expect((await deviceCard(newId)).status).toBe("removed");
    });

    it("refuses a date before the current tracker went on", async () => {
      const id = await client.createObject({ installedOn: WEEK_AGO });

      const response = await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: MONTH_AGO,
        moveSim: true,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "installation_date_overlap",
        fieldErrors: { installedOn: `Поточне встановлення почалося ${dateText(WEEK_AGO)}: дата не може бути раніше` },
      });
    });

    it("refuses a tracker back to a date it stood somewhere else", async () => {
      const deviceId = await registerDevice();
      const first = await client.createObject({ device: { deviceId } });
      await client.call("POST", `/objects/${first}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: YESTERDAY,
        moveSim: true,
      });
      const second = await client.createObject();

      const response = await client.call("POST", `/objects/${second}/replace-device`, {
        device: { deviceId },
        installedOn: WEEK_AGO,
        moveSim: true,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "installation_date_overlap" });
    });

    it("takes a replacement on the day the tracker went on: a period that never was", async () => {
      const id = await client.createObject({ installedOn: TODAY });

      const response = await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: TODAY,
        moveSim: true,
      });

      expect(response.statusCode).toBe(204);
      expect((await client.history(id)).devices).toHaveLength(2);
    });

    it("lets two people replace a tracker with the same one: one of them gets it", async () => {
      const newId = await registerDevice();
      const first = await client.createObject();
      const second = await client.createObject();
      const body = { device: { deviceId: newId }, installedOn: TODAY, moveSim: true };

      const responses = await Promise.all([
        client.call("POST", `/objects/${first}/replace-device`, body),
        client.call("POST", `/objects/${second}/replace-device`, body),
      ]);

      expect(responses.map((response) => response.statusCode).sort()).toEqual([204, 409]);
    });

    it("has the database refuse a second tracker on one object and one tracker twice", async () => {
      const id = await client.createObject();
      const otherId = await registerDevice();
      const { device } = await client.objectCard(id);

      await expect(
        owner.$executeRaw`
          INSERT INTO device_installations (object_id, device_id, valid_from)
          VALUES (${id}::uuid, ${otherId}::uuid, ${WEEK_AGO}::date)
        `,
      ).rejects.toThrow(/device_installations_object_no_overlap/);
      const secondObject = await client.createObject();
      await expect(
        owner.$executeRaw`
          INSERT INTO device_installations (object_id, device_id, valid_from)
          VALUES (${secondObject}::uuid, ${device?.id}::uuid, ${WEEK_AGO}::date)
        `,
      ).rejects.toThrow(/no_overlap/);
    });
  });

  describe("a replacement of the SIM", () => {
    it("keeps the tracker, closes the old SIM and frees it", async () => {
      const oldSim = await registerSim();
      const id = await client.createObject({ sim: { simId: oldSim } });
      const iccid = nextIccid();

      const response = await client.call("POST", `/objects/${id}/replace-sim`, {
        sim: { iccid },
        installedOn: WEEK_AGO,
      });

      expect(response.statusCode).toBe(204);
      expect((await client.objectCard(id)).sim).toMatchObject({ iccid, installedOn: WEEK_AGO });
      expect((await simCard(oldSim)).status).toBe("free");
      expect((await client.history(id)).sims).toHaveLength(2);
    });

    it("leaves a blocked SIM blocked", async () => {
      const simId = await registerSim();
      const id = await client.createObject({ sim: { simId } });
      const card = await simCard(simId);
      const { iccid, msisdn, operatorId, planId, note, version } = card;
      const update = { iccid, msisdn, operatorId, planId, note, version, status: "blocked" };
      await client.call("PATCH", `/sims/${simId}`, update);

      await client.call("POST", `/objects/${id}/replace-sim`, { sim: { iccid: nextIccid() }, installedOn: TODAY });

      expect((await simCard(simId)).status).toBe("blocked");
    });

    it("keeps a blocked SIM blocked when it moves with its tracker", async () => {
      const simId = await registerSim();
      const id = await client.createObject({ sim: { simId } });
      const { iccid, msisdn, operatorId, planId, note, version } = await simCard(simId);
      await client.call("PATCH", `/sims/${simId}`, {
        iccid,
        msisdn,
        operatorId,
        planId,
        note,
        version,
        status: "blocked",
      });

      await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: TODAY,
        moveSim: true,
      });

      expect((await simCard(simId)).status).toBe("blocked");
    });
  });

  describe("sensors", () => {
    it("goes on and comes off with dates", async () => {
      const id = await client.createObject();
      const contractorId = await client.create("/contractors", { name: "Підрядник 1" });

      const added = await client.call("POST", `/objects/${id}/sensors`, {
        sensor: { serialNo: "ДУТ-1" },
        installedOn: WEEK_AGO,
        contractorId,
      });
      const [sensor] = (await client.objectCard(id)).sensors;
      const removed = await client.call("POST", `/objects/${id}/sensors/${sensor?.id}/remove`, {
        removedOn: YESTERDAY,
      });

      expect(added.statusCode).toBe(204);
      expect(sensor).toMatchObject({ serialNo: "ДУТ-1", installedOn: WEEK_AGO, contractorName: "Підрядник 1" });
      expect(removed.statusCode).toBe(204);
      expect((await client.objectCard(id)).sensors).toEqual([]);
      expect((await client.history(id)).sensors).toMatchObject([{ validFrom: WEEK_AGO, validTo: YESTERDAY }]);
    });

    it("is on one object at a time", async () => {
      const first = await client.createObject();
      const second = await client.createObject();
      const body = { sensor: { serialNo: "ДУТ-1" }, installedOn: TODAY };
      await client.call("POST", `/objects/${first}/sensors`, body);

      const response = await client.call("POST", `/objects/${second}/sensors`, body);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "equipment_unavailable" });
    });

    it("answers 404 for a sensor on another object, whatever the date", async () => {
      const id = await client.createObject();
      const other = await client.createObject({ sensors: [{ sensor: { serialNo: "ДУТ-3" }, installedOn: TODAY }] });
      const [sensor] = (await client.objectCard(other)).sensors;

      const response = await client.call("POST", `/objects/${id}/sensors/${sensor?.id}/remove`, {
        removedOn: WEEK_AGO,
      });

      expect(response.statusCode).toBe(404);
    });

    it("answers 404 for a sensor that is not on the object", async () => {
      const id = await client.createObject();
      const other = "019a0000-0000-7000-8000-000000000000";

      const response = await client.call("POST", `/objects/${id}/sensors/${other}/remove`, { removedOn: TODAY });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("the archive", () => {
    it("takes only a disconnected object", async () => {
      const id = await client.createObject();

      const response = await client.call("POST", `/objects/${id}/archive`, {});

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "object_not_disconnected" });
    });

    it("lets everything on it go, and takes it off the counts of the client", async () => {
      const deviceId = await registerDevice();
      const simId = await registerSim();
      const id = await archived({
        device: { deviceId },
        sim: { simId },
        sensors: [{ sensor: { serialNo: "ДУТ-1" }, installedOn: MONTH_AGO }],
      });

      expect(await deviceCard(deviceId)).toMatchObject({ status: "removed", place: null });
      expect(await simCard(simId)).toMatchObject({ status: "free", deviceImei: null });
      expect((await client.history(id)).devices[0]).toMatchObject({ validTo: TODAY });
      expect((await client.history(id)).sensors[0]).toMatchObject({ validTo: TODAY });
      expect(await client.card(client.subscriberId)).toMatchObject({ objectsDisconnected: 0, status: "disconnected" });
      expect(await client.journal("object.archived")).toHaveLength(1);
    });

    it("frees the tracker for another object at once", async () => {
      const deviceId = await registerDevice();
      await archived({ device: { deviceId } });

      const id = await client.createObject({
        device: { deviceId },
        installedOn: TODAY,
        connectedOn: TODAY,
        statusFrom: TODAY,
      });

      expect((await client.objectCard(id)).device?.id).toBe(deviceId);
    });

    it("brings an object back disconnected and with nothing on it", async () => {
      const id = await archived();

      const response = await client.call("POST", `/objects/${id}/restore`, {});

      expect(response.statusCode).toBe(204);
      expect(await client.objectCard(id)).toMatchObject({ status: "disconnected", device: null, sim: null });
      expect(await client.card(client.subscriberId)).toMatchObject({ objectsDisconnected: 1 });
      expect(await client.journal("object.restored")).toHaveLength(1);
    });

    it("wants a tracker before a reconnection, and lets one on", async () => {
      const id = await archived();
      await client.call("POST", `/objects/${id}/restore`, {});

      const refused = await client.call("POST", `/objects/${id}/status`, { status: "active", validFrom: TODAY });
      const noSim = await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: TODAY,
        moveSim: true,
      });
      const replaced = await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: TODAY,
        moveSim: false,
        sim: { iccid: nextIccid() },
      });
      const reconnected = await client.call("POST", `/objects/${id}/status`, { status: "active", validFrom: TODAY });

      expect(refused.json()).toMatchObject({ code: "object_without_tracker" });
      expect(noSim.json()).toMatchObject({ code: "no_sim_to_move" });
      expect(replaced.statusCode).toBe(204);
      expect(reconnected.statusCode).toBe(204);
      expect(await client.objectCard(id)).toMatchObject({ status: "active", device: { installedOn: TODAY } });
    });

    it("refuses a reconnection on a payer the client no longer has, and says what to do", async () => {
      const id = await client.createObject();
      const second = await client.addPayer("Другий");
      await client.call("POST", `/objects/${id}/terms`, { validFrom: TODAY, payerId: second });
      await disconnect(id);
      await client.call("DELETE", `/subscribers/${client.subscriberId}/payers/${second}/link`);

      const refused = await client.call("POST", `/objects/${id}/status`, { status: "active", validFrom: TODAY });
      await client.call("POST", `/subscribers/${client.subscriberId}/payers/${second}/link`, {});
      const reconnected = await client.call("POST", `/objects/${id}/status`, { status: "active", validFrom: TODAY });

      expect(refused.json()).toMatchObject({ code: "payer_unavailable" });
      expect(reconnected.statusCode).toBe(204);
    });

    it("waits for its client", async () => {
      const id = await archived();
      await client.call("POST", `/subscribers/${client.subscriberId}/archive`, {});

      const response = await client.call("POST", `/objects/${id}/restore`, {});

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "restore_blocked" });
    });

    it("answers a second press as no change", async () => {
      const id = await archived();

      expect((await client.call("POST", `/objects/${id}/archive`, {})).statusCode).toBe(204);
      await client.call("POST", `/objects/${id}/restore`, {});
      expect((await client.call("POST", `/objects/${id}/restore`, {})).statusCode).toBe(204);
    });

    it("refuses a change of an object in the archive", async () => {
      const id = await client.createObject();
      const { version } = await client.objectCard(id);
      await disconnect(id);
      await client.call("POST", `/objects/${id}/archive`, {});

      const patch = await client.call("PATCH", `/objects/${id}`, { name: "Нова", note: null, version });
      const status = await client.call("POST", `/objects/${id}/status`, { status: "active", validFrom: TODAY });

      expect(patch.json()).toMatchObject({ code: "record_archived" });
      expect(status.json()).toMatchObject({ code: "record_archived" });
    });

    it("brings the object back from the page of the archive as well", async () => {
      const id = await archived();
      const [batch] = await owner.archiveBatch.findMany({ where: { entityType: "object" } });

      const response = await client.call("POST", `/archive/${batch?.id}/restore`, {});

      expect(response.statusCode).toBe(204);
      expect((await client.objectCard(id)).isArchived).toBe(false);
    });
  });

  describe("the package of a client", () => {
    it("takes the disconnected objects with their client and lets their equipment go", async () => {
      const deviceId = await registerDevice();
      const id = await client.createObject({ device: { deviceId } });
      await disconnect(id);

      const response = await client.call("POST", `/subscribers/${client.subscriberId}/archive`, {});

      expect(response.statusCode).toBe(204);
      expect((await client.objectCard(id)).isArchived).toBe(true);
      expect((await deviceCard(deviceId)).status).toBe("removed");
      expect(await client.journal("object.archived")).toMatchObject([{ entityType: "object", entityId: id }]);
    });

    it("refuses while an object works", async () => {
      await client.createObject();

      const response = await client.call("POST", `/subscribers/${client.subscriberId}/archive`, {});

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "subscriber_has_objects" });
    });

    it("brings the objects back with their client, counted", async () => {
      const id = await client.createObject();
      await disconnect(id);
      await client.call("POST", `/subscribers/${client.subscriberId}/archive`, {});

      await client.call("POST", `/subscribers/${client.subscriberId}/restore`, {});

      expect(await client.objectCard(id)).toMatchObject({ isArchived: false, status: "disconnected", device: null });
      expect(await client.card(client.subscriberId)).toMatchObject({ objectsDisconnected: 1 });
      expect(await client.journal("object.restored")).toHaveLength(1);
    });

    it("leaves an object that went alone in the archive", async () => {
      const id = await archived();
      await client.call("POST", `/subscribers/${client.subscriberId}/archive`, {});

      await client.call("POST", `/subscribers/${client.subscriberId}/restore`, {});

      expect((await client.objectCard(id)).isArchived).toBe(true);
    });

    it("counts the objects in the size of the package", async () => {
      await disconnect(await client.createObject());
      await disconnect(await client.createObject());

      await client.call("POST", `/subscribers/${client.subscriberId}/archive`, {});

      const [batch] = await owner.archiveBatch.findMany({ where: { entityType: "subscriber" } });
      // The client, its contact, its payer and two objects
      expect(batch?.itemCount).toBe(5);
    });
  });

  describe("the delete", () => {
    it("removes a mistake and lets the equipment go as if it never went on", async () => {
      const deviceId = await registerDevice();
      const simId = await registerSim();
      const id = await client.createObject({
        device: { deviceId },
        sim: { simId },
        sensors: [{ sensor: { serialNo: "ДУТ-1" }, installedOn: MONTH_AGO }],
      });

      const response = await client.call("DELETE", `/objects/${id}`);

      expect(response.statusCode).toBe(204);
      expect((await client.call("GET", `/objects/${id}`)).statusCode).toBe(404);
      expect(await deviceCard(deviceId)).toMatchObject({ status: "removed", history: [] });
      expect((await simCard(simId)).status).toBe("free");
      expect(await client.card(client.subscriberId)).toMatchObject({ objectsActive: 0 });
      expect((await client.call("DELETE", `/devices/${deviceId}`)).statusCode).toBe(204);
      expect(await client.journal("object.deleted")).toHaveLength(1);
    });

    it("keeps the past of a tracker from an earlier object", async () => {
      const deviceId = await registerDevice();
      await archived({ device: { deviceId } });
      const id = await client.createObject({
        device: { deviceId },
        installedOn: TODAY,
        connectedOn: TODAY,
        statusFrom: TODAY,
      });

      await client.call("DELETE", `/objects/${id}`);

      expect((await deviceCard(deviceId)).history).toHaveLength(1);
      expect(await owner.simInstallation.count({ where: { deviceId } })).toBe(1);
    });

    it("refuses an object with a history", async () => {
      const id = await client.createObject();
      await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: TODAY });

      const response = await client.call("DELETE", `/objects/${id}`);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "object_has_history" });
    });

    it("refuses one with a replaced tracker", async () => {
      const id = await client.createObject();
      await client.call("POST", `/objects/${id}/replace-device`, {
        device: { imei: nextImei() },
        installedOn: TODAY,
        moveSim: true,
      });

      expect((await client.call("DELETE", `/objects/${id}`)).statusCode).toBe(409);
    });

    it("refuses one in the archive", async () => {
      const id = await archived();

      const response = await client.call("DELETE", `/objects/${id}`);

      expect(response.json()).toMatchObject({ code: "record_archived" });
    });
  });

  describe("what the client gets from its objects", () => {
    const search = async (text: string) => {
      const response = await client.call("GET", `/subscribers?q=${encodeURIComponent(text)}`);
      return items<SubscriberListItem>(response).map((row) => row.id);
    };

    it("finds a client by the IMEI, ICCID and number of the equipment on its objects", async () => {
      const imei = nextImei();
      const iccid = nextIccid();
      await client.createObject({ device: { imei }, sim: { iccid, msisdn: "0509876543" } });

      expect(await search(imei.slice(-7))).toEqual([client.subscriberId]);
      expect(await search(iccid)).toEqual([client.subscriberId]);
      expect(await search("9876543")).toEqual([client.subscriberId]);
    });

    it("does not find a client by a tracker that came off", async () => {
      const imei = nextImei();
      await archived({ device: { imei } });

      expect(await search(imei)).toEqual([]);
    });

    it("refuses to delete a client with an object, even one in the archive", async () => {
      await archived();

      const response = await client.call("DELETE", `/subscribers/${client.subscriberId}`);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "subscriber_has_objects" });
    });

    it("shows how many objects a payer carries", async () => {
      await client.createObject();
      await disconnect(await client.createObject());
      await archived();

      const [payer] = await client.payersOf(client.subscriberId);

      expect(payer?.objectCount).toBe(2);
    });

    it("keeps a payer with working objects out of the archive and on the client", async () => {
      const id = await client.createObject();

      const archive = await client.call("POST", `/payers/${client.payerId}/archive`, {});
      const unlink = await client.call("DELETE", `/subscribers/${client.subscriberId}/payers/${client.payerId}/link`);

      expect(archive.statusCode).toBe(409);
      expect(archive.json()).toMatchObject({ code: "payer_in_use" });
      expect(unlink.json()).toMatchObject({ code: "payer_in_use" });

      await disconnect(id);

      expect((await client.call("POST", `/payers/${client.payerId}/archive`, {})).statusCode).toBe(204);
    });
  });
});
