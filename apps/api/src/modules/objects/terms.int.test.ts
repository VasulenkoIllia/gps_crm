import { dateText, type ObjectListItem, type SubscriberCard } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import {
  createReason,
  MONTH_AGO,
  NEXT_MONTH,
  nextImei,
  resetObjects,
  startObjectApi,
  TODAY,
  WEEK_AGO,
  YESTERDAY,
  type ObjectApi,
} from "../../test-objects.js";
import { createAddon, createPlace, createTariff, items, withoutPermission } from "../../test-references.js";

describe("the history of an object", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ObjectApi;

  const list = async (query = "") => items<ObjectListItem>(await client.call("GET", `/objects?${query}`));
  const names = async (query = "") => (await list(query)).map((row) => row.name);
  const clientCard = (): Promise<SubscriberCard> => client.card(client.subscriberId);

  async function disconnect(id: string, validFrom = TODAY): Promise<void> {
    const reasonId = await createReason(client);
    await client.call("POST", `/objects/${id}/status`, { status: "disconnected", validFrom, reasonId });
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

  describe("statuses", () => {
    it("closes the period and opens the next on one date, and moves the client with it", async () => {
      const id = await client.createObject();

      const response = await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: WEEK_AGO });

      expect(response.statusCode).toBe(204);
      expect((await client.history(id)).statuses).toMatchObject([
        { status: "suspended", validFrom: WEEK_AGO, validTo: null },
        { status: "active", validFrom: MONTH_AGO, validTo: WEEK_AGO },
      ]);
      expect(await clientCard()).toMatchObject({ objectsActive: 0, objectsSuspended: 1, status: "suspended" });
    });

    it("wants a reason for a disconnection, and keeps it", async () => {
      const id = await client.createObject();
      const reasonId = await createReason(client);

      const refused = await client.call("POST", `/objects/${id}/status`, { status: "disconnected", validFrom: TODAY });
      const response = await client.call("POST", `/objects/${id}/status`, {
        status: "disconnected",
        validFrom: TODAY,
        reasonId,
        note: "Клієнт повернув техніку",
      });

      expect(refused.statusCode).toBe(400);
      expect(response.statusCode).toBe(204);
      expect(await client.objectCard(id)).toMatchObject({ disconnectedOn: TODAY, disconnectReasonName: "Причина" });
      expect((await client.history(id)).statuses[0]).toMatchObject({
        reasonName: "Причина",
        note: "Клієнт повернув техніку",
      });
    });

    it("reconnects with a new period, and the date of connection stays", async () => {
      const id = await client.createObject();
      await disconnect(id, WEEK_AGO);

      const response = await client.call("POST", `/objects/${id}/status`, { status: "active", validFrom: YESTERDAY });

      expect(response.statusCode).toBe(204);
      expect(await client.objectCard(id)).toMatchObject({
        status: "active",
        connectedOn: MONTH_AGO,
        disconnectedOn: null,
        disconnectReasonName: null,
      });
      expect(await clientCard()).toMatchObject({ objectsActive: 1, objectsDisconnected: 0 });
    });

    it("takes a disconnection and a reconnection on one day", async () => {
      const id = await client.createObject();
      await disconnect(id);

      await client.call("POST", `/objects/${id}/status`, { status: "active", validFrom: TODAY });

      expect((await client.history(id)).statuses).toMatchObject([
        { status: "active", validFrom: TODAY, validTo: null },
        { status: "disconnected", validFrom: TODAY, validTo: TODAY },
        { status: "active", validFrom: MONTH_AGO, validTo: TODAY },
      ]);
    });

    it("refuses a date before the current status and one ahead", async () => {
      const id = await client.createObject({ statusFrom: WEEK_AGO });

      const before = await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: MONTH_AGO });
      const ahead = await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: NEXT_MONTH });

      expect(before.statusCode).toBe(409);
      expect(before.json()).toMatchObject({
        code: "status_date_overlap",
        fieldErrors: { validFrom: `Поточний статус діє з ${dateText(WEEK_AGO)}: нова дата має бути не раніше` },
      });
      expect(ahead.statusCode).toBe(400);
    });

    it("refuses the same status and a way that does not exist", async () => {
      const id = await client.createObject();
      await disconnect(id);

      const same = await client.call("POST", `/objects/${id}/status`, {
        status: "disconnected",
        validFrom: TODAY,
        reasonId: await createReason(client, "Інша"),
      });
      const refused = await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: TODAY });

      expect(same.json()).toMatchObject({ code: "status_unchanged" });
      expect(refused.json()).toMatchObject({ code: "status_refused" });
    });

    it("needs the permission of its own", async () => {
      const id = await client.createObject();

      await withoutPermission(owner, "objects.status.change", async () => {
        const response = await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: TODAY });
        expect(response.statusCode).toBe(403);
      });
    });

    it("has the database refuse an overlap, whatever the code does", async () => {
      const id = await client.createObject();

      await expect(
        owner.$executeRaw`
          INSERT INTO object_status_periods (object_id, status, valid_from)
          VALUES (${id}::uuid, 'suspended', ${MONTH_AGO}::date)
        `,
      ).rejects.toThrow(/object_status_periods_no_overlap/);
    });
  });

  describe("a disconnected object", () => {
    it("takes no change but a reconnection", async () => {
      const id = await client.createObject();
      const { version } = await client.objectCard(id);
      await disconnect(id);

      const responses = await Promise.all([
        client.call("PATCH", `/objects/${id}`, { name: "Нова", note: null, version }),
        client.call("POST", `/objects/${id}/terms`, { validFrom: TODAY, payerId: client.payerId }),
        client.call("POST", `/objects/${id}/replace-device`, {
          device: { imei: nextImei() },
          installedOn: TODAY,
          moveSim: true,
        }),
      ]);

      expect(responses.map((response) => response.json<{ code: string }>().code)).toEqual([
        "object_disconnected",
        "object_disconnected",
        "object_disconnected",
      ]);
    });
  });

  describe("terms", () => {
    it("puts an object on its own tariff and back", async () => {
      const id = await client.createObject();
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const tariffId = await createTariff(client, place, { name: "Тариф 2" });
      const ownTariff = { programId: place.programId, tariffId };

      const own = await client.call("POST", `/objects/${id}/terms`, { validFrom: WEEK_AGO, ownTariff });

      expect(own.statusCode).toBe(204);
      expect(await client.objectCard(id)).toMatchObject({
        tariff: { tariffId, isOwn: true, programName: "Програма 2" },
      });
      expect(await names(`programId=${place.programId}`)).toHaveLength(1);

      await client.call("POST", `/objects/${id}/terms`, { validFrom: TODAY, ownTariff: null });

      expect(await client.objectCard(id)).toMatchObject({
        tariff: { tariffId: client.tariffId, isOwn: false, programName: "Програма 1" },
      });
      expect((await list())[0]).toMatchObject({ hasOwnTariff: false, programName: "Програма 1" });
      expect(await client.journal("object.terms_changed")).toHaveLength(2);
    });

    it("replaces a version that has not begun, and one of the same date", async () => {
      const id = await client.createObject();
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const tariffId = await createTariff(client, place, { name: "Тариф 2" });
      const ownTariff = { programId: place.programId, tariffId };
      await client.call("POST", `/objects/${id}/terms`, { validFrom: NEXT_MONTH, ownTariff });

      await client.call("POST", `/objects/${id}/terms`, { validFrom: TODAY, ownTariff: null });

      const { terms } = await client.history(id);
      expect(terms).toMatchObject([{ validFrom: TODAY, validTo: null, ownTariffName: null }, { validFrom: MONTH_AGO }]);
    });

    it("does not rewrite the past", async () => {
      const id = await client.createObject();
      await client.call("POST", `/objects/${id}/terms`, { validFrom: YESTERDAY, ownTariff: null });

      const response = await client.call("POST", `/objects/${id}/terms`, { validFrom: WEEK_AGO, ownTariff: null });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "terms_date_overlap" });
    });

    it("changes a payer from a date, and a tariff planned ahead stays planned under the new payer", async () => {
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const tariffId = await createTariff(client, place, { name: "Тариф 2" });
      const id = await client.createObject({
        ownTariff: { programId: place.programId, tariffId, validFrom: NEXT_MONTH },
      });
      const payerId = await client.addPayer("Другий");

      const response = await client.call("POST", `/objects/${id}/terms`, { validFrom: YESTERDAY, payerId });

      expect(response.statusCode).toBe(204);
      expect(await client.objectCard(id)).toMatchObject({
        payerId,
        payerName: "Другий",
        payerFrom: YESTERDAY,
        nextTariff: { tariffId, validFrom: NEXT_MONTH },
      });
      expect((await client.history(id)).terms).toMatchObject([
        { validFrom: NEXT_MONTH, validTo: null, payerName: "Другий", ownTariffName: "Тариф 2" },
        { validFrom: YESTERDAY, validTo: NEXT_MONTH, payerName: "Другий", ownTariffName: null },
        { validFrom: MONTH_AGO, validTo: YESTERDAY, ownTariffName: null },
      ]);
    });

    it("refuses a payer of another client and an empty change", async () => {
      const id = await client.createObject();
      const other = await client.createClient({ name: "Інший" });
      const [payer] = await client.payersOf(other.id);

      const foreign = await client.call("POST", `/objects/${id}/terms`, { validFrom: TODAY, payerId: payer?.id });
      const empty = await client.call("POST", `/objects/${id}/terms`, { validFrom: TODAY });

      expect(foreign.statusCode).toBe(422);
      expect(empty.statusCode).toBe(400);
    });

    it("has the database refuse an overlap of versions", async () => {
      const id = await client.createObject();

      await expect(
        owner.$executeRaw`
          INSERT INTO object_service_terms (object_id, payer_id, valid_from)
          VALUES (${id}::uuid, ${client.payerId}::uuid, ${WEEK_AGO}::date)
        `,
      ).rejects.toThrow(/object_service_terms_no_overlap/);
    });
  });

  describe("the tariff of the client", () => {
    async function changeClientTariff(place: { programId: string }, tariffId: string, validFrom = TODAY) {
      const path = `/subscribers/${client.subscriberId}/tariff`;
      return client.call("POST", path, { programId: place.programId, tariffId, validFrom });
    }

    it("carries an object without a tariff of its own, program and server included", async () => {
      const id = await client.createObject();
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const tariffId = await createTariff(client, place, { name: "Тариф 2" });

      await changeClientTariff(place, tariffId);

      expect(await client.objectCard(id)).toMatchObject({
        tariff: { tariffId, programName: "Програма 2", serverName: "Сервер 2", isOwn: false },
      });
      const row = await owner.monitoredObject.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({ tariffId, programId: place.programId, serverId: place.serverId });
    });

    it("leaves an object with its own tariff where it is", async () => {
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const ownId = await createTariff(client, place, { name: "Свій" });
      const id = await client.createObject({
        ownTariff: { programId: place.programId, tariffId: ownId, validFrom: MONTH_AGO },
      });
      const tariffId = await createTariff(client, client.place, { name: "Тариф 2" });

      await changeClientTariff(client.place, tariffId);

      expect(await client.objectCard(id)).toMatchObject({ tariff: { tariffId: ownId, isOwn: true } });
    });

    it("carries an object out of the archive too", async () => {
      const id = await client.createObject();
      await disconnect(id);
      await client.call("POST", `/objects/${id}/archive`, {});
      const tariffId = await createTariff(client, client.place, { name: "Тариф 2" });

      await changeClientTariff(client.place, tariffId);

      const row = await owner.monitoredObject.findUniqueOrThrow({ where: { id } });
      expect(row.tariffId).toBe(tariffId);
    });
  });

  describe("addons", () => {
    it("connects and disconnects with dates, in the history", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      const id = await client.createObject();

      await client.call("POST", `/objects/${id}/addons`, { addonId, action: "connect", date: WEEK_AGO });
      await client.call("POST", `/objects/${id}/addons`, { addonId, action: "disconnect", date: YESTERDAY });

      expect((await client.objectCard(id)).addons).toEqual([]);
      expect((await client.history(id)).addons).toMatchObject([
        { addonName: "Послуга 1", validFrom: WEEK_AGO, validTo: YESTERDAY },
      ]);
      expect(await client.journal("object.addons_changed")).toHaveLength(2);
    });

    it("takes a form with the same service twice as a mistake of the form", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      const twice = [
        { addonId, validFrom: WEEK_AGO },
        { addonId, validFrom: TODAY },
      ];

      const response = await client.call("POST", "/objects", client.objectForm({ addons: twice }));

      expect(response.json()).toMatchObject({ fieldErrors: { addons: "Ця послуга вже є в списку" } });
    });

    it("checks a service against the program of its date, not of a tariff planned ahead", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      const other = await createPlace(client, "Інша програма", "Інший сервер");
      const tariffId = await createTariff(client, other);
      const id = await client.createObject();
      await client.call("POST", `/objects/${id}/terms`, {
        validFrom: NEXT_MONTH,
        ownTariff: { programId: other.programId, tariffId },
      });

      const response = await client.call("POST", `/objects/${id}/addons`, { addonId, action: "connect", date: TODAY });

      expect(response.statusCode).toBe(204);
    });

    it("refuses a second connection and a disconnection of what is not on", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      const id = await client.createObject({ addons: [{ addonId, validFrom: WEEK_AGO }] });

      const twice = await client.call("POST", `/objects/${id}/addons`, { addonId, action: "connect", date: TODAY });
      await client.call("POST", `/objects/${id}/addons`, { addonId, action: "disconnect", date: TODAY });
      const off = await client.call("POST", `/objects/${id}/addons`, { addonId, action: "disconnect", date: TODAY });

      expect(twice.json()).toMatchObject({ code: "addon_connected" });
      expect(off.json()).toMatchObject({ code: "addon_not_connected" });
    });

    it("keeps the dates in order", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      const id = await client.createObject({ addons: [{ addonId, validFrom: WEEK_AGO }] });

      const before = await client.call("POST", `/objects/${id}/addons`, {
        addonId,
        action: "disconnect",
        date: MONTH_AGO,
      });
      await client.call("POST", `/objects/${id}/addons`, { addonId, action: "disconnect", date: YESTERDAY });
      const inside = await client.call("POST", `/objects/${id}/addons`, { addonId, action: "connect", date: WEEK_AGO });

      expect(before.json()).toMatchObject({ code: "addon_date_overlap" });
      expect(inside.json()).toMatchObject({ code: "addon_date_overlap" });
    });

    it("disconnects an addon that has been deactivated since", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      const id = await client.createObject({ addons: [{ addonId, validFrom: WEEK_AGO }] });
      await client.post(`/addons/${addonId}/deactivate`);

      const response = await client.call("POST", `/objects/${id}/addons`, {
        addonId,
        action: "disconnect",
        date: TODAY,
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
