import { type ObjectList, type ObjectListItem, type SubscriberCard } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ALL_RECORDS } from "../../core/access/access.js";
import type { DbClient } from "../../core/db/client.js";
import { createStatementLog } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase, testAppDatabaseUrl } from "../../core/db/test-database.js";
import {
  createReason,
  MONTH_AGO,
  NEXT_MONTH,
  nextIccid,
  nextImei,
  resetObjects,
  setScope,
  startObjectApi,
  TODAY,
  WEEK_AGO,
  YESTERDAY,
  type ObjectApi,
} from "../../test-objects.js";
import { createAddon, createPlace, createTariff, items, withoutPermission } from "../../test-references.js";
import { listObjects } from "./objects.queries.js";

const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";
const SMALL_PAGE = 25;
const BIG_PAGE = 100;

describe("objects", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ObjectApi;

  const list = async (query = "") => items<ObjectListItem>(await client.call("GET", `/objects?${query}`));
  const names = async (query = "") => (await list(query)).map((row) => row.name);
  const countOf = async (query = "") => (await client.call("GET", `/objects/count?${query}`)).json<object>();
  const clientCard = (): Promise<SubscriberCard> => client.card(client.subscriberId);

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

  describe("creation", () => {
    it("makes an object with a new tracker and SIM, on the tariff of the client", async () => {
      const contractorId = await client.create("/contractors", { name: "Підрядник 1" });
      const imei = nextImei();
      const iccid = nextIccid();

      const id = await client.createObject({ name: "Вантажівка", device: { imei }, sim: { iccid }, contractorId });

      expect(await client.objectCard(id)).toMatchObject({
        name: "Вантажівка",
        status: "active",
        statusFrom: MONTH_AGO,
        connectedOn: MONTH_AGO,
        payerId: client.payerId,
        tariff: { tariffId: client.tariffId, isOwn: false },
        device: { imei, installedOn: MONTH_AGO, contractorName: "Підрядник 1" },
        sim: { iccid, installedOn: MONTH_AGO, contractorName: "Підрядник 1" },
      });
      expect(await client.journal("object.created")).toHaveLength(1);
      expect(await client.journal("device.installed")).toMatchObject([{ entityType: "object", entityId: id }]);
      expect(await client.journal("device.created")).toHaveLength(1);
    });

    it("counts the object on its client in the same transaction", async () => {
      await client.createObject();
      await client.createObject({ status: "suspended" });

      expect(await clientCard()).toMatchObject({
        objectsActive: 1,
        objectsSuspended: 1,
        status: "partially_suspended",
      });
    });

    it("takes a free tracker from the list and a free one by its number", async () => {
      const first = await client.call("POST", "/devices", { imei: nextImei() });
      const imei = nextImei();
      await client.call("POST", "/devices", { imei });

      await client.createObject({ device: { deviceId: first.json<{ id: string }>().id } });
      await client.createObject({ device: { imei } });

      expect(await client.journal("device.created")).toHaveLength(2);
    });

    it("refuses a tracker that stands on another object, naming it", async () => {
      const imei = nextImei();
      await client.createObject({ name: "Вантажівка", device: { imei } });

      const response = await client.call("POST", "/objects", client.objectForm({ device: { imei } }));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "equipment_unavailable",
        fieldErrors: { "device.imei": `Трекер з IMEI ${imei} уже встановлений на об'єкті «Вантажівка»` },
      });
    });

    it("refuses a SIM in another tracker, naming it", async () => {
      const iccid = nextIccid();
      const imei = nextImei();
      await client.createObject({ device: { imei }, sim: { iccid } });

      const response = await client.call("POST", "/objects", client.objectForm({ sim: { iccid } }));

      expect(response.json()).toMatchObject({ message: `SIM ${iccid} уже в трекері ${imei}` });
    });

    it("lets one of two people have a tracker, and tells the other why", async () => {
      const imei = nextImei();
      const forms = [client.objectForm({ device: { imei } }), client.objectForm({ device: { imei } })];

      const responses = await Promise.all(forms.map((form) => client.call("POST", "/objects", form)));

      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
      expect(await list()).toHaveLength(1);
    });

    it("leaves nothing behind when a part of it fails", async () => {
      const response = await client.call("POST", "/objects", client.objectForm({ payerId: UNKNOWN_ID }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ fieldErrors: { payerId: "Оберіть платника цього клієнта" } });
      expect(await owner.device.count()).toBe(0);
      expect(await owner.sim.count()).toBe(0);
    });

    it("takes a payer only of this client", async () => {
      const other = await client.createClient({ name: "Інший" });
      const [payer] = await client.payersOf(other.id);

      const response = await client.call("POST", "/objects", client.objectForm({ payerId: payer?.id }));

      expect(response.statusCode).toBe(422);
    });

    it("refuses an archived client", async () => {
      await client.call("POST", `/subscribers/${client.subscriberId}/archive`, {});

      const response = await client.call("POST", "/objects", client.objectForm());

      expect(response.json()).toMatchObject({ code: "subscriber_archived" });
    });

    it("wants the date a tracker went on", async () => {
      const response = await client.call("POST", "/objects", client.objectForm({ installedOn: "" }));

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Вкажіть дату встановлення трекера");
    });

    it("gives an object a tariff of any program from a date, on the tariff of the client before it", async () => {
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const tariffId = await createTariff(client, place, { name: "Тариф 2" });

      const id = await client.createObject({
        ownTariff: { programId: place.programId, tariffId, validFrom: NEXT_MONTH },
      });

      expect(await client.objectCard(id)).toMatchObject({
        tariff: { tariffId: client.tariffId, isOwn: false },
        nextTariff: { tariffId, isOwn: true, validFrom: NEXT_MONTH, programId: place.programId },
      });
      expect((await list())[0]).toMatchObject({ tariffName: "Тариф 2", hasOwnTariff: true, programName: "Програма 2" });
      expect((await client.history(id)).terms).toMatchObject([
        { validFrom: NEXT_MONTH, validTo: null, ownTariffName: "Тариф 2" },
        { validFrom: MONTH_AGO, validTo: NEXT_MONTH, ownTariffName: null },
      ]);
    });

    it("marks an own tariff as taken, so its price stays as it was", async () => {
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const tariffId = await createTariff(client, place, { name: "Тариф 2" });

      await client.createObject({ ownTariff: { programId: place.programId, tariffId, validFrom: MONTH_AGO } });

      const tariff = await owner.tariff.findUniqueOrThrow({ where: { id: tariffId } });
      expect(tariff.selectedAt).not.toBeNull();
    });

    it("refuses a tariff outside the named program", async () => {
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const ownTariff = { programId: place.programId, tariffId: client.tariffId, validFrom: MONTH_AGO };

      const response = await client.call("POST", "/objects", client.objectForm({ ownTariff }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "tariff_unavailable" });
    });

    it("takes addons of the program of the object and no other", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      const other = await createPlace(client, "Програма 2", "Сервер 2");
      const foreignId = await createAddon(client, [other.programId], "Послуга 2");

      const id = await client.createObject({ addons: [{ addonId, validFrom: WEEK_AGO }] });
      const refused = await client.call(
        "POST",
        "/objects",
        client.objectForm({ addons: [{ addonId: foreignId, validFrom: WEEK_AGO }] }),
      );

      expect((await client.objectCard(id)).addons).toMatchObject([{ addonName: "Послуга 1", validFrom: WEEK_AGO }]);
      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ message: "Ця послуга недоступна для програми Програма 1" });
    });

    it("installs sensors, each with its date", async () => {
      const sensors = [
        { sensor: { serialNo: "ДУТ-1" }, installedOn: WEEK_AGO },
        { sensor: { serialNo: "ДУТ-2" }, installedOn: YESTERDAY },
      ];

      const id = await client.createObject({ sensors });

      expect((await client.objectCard(id)).sensors.map((sensor) => sensor.serialNo).sort()).toEqual(["ДУТ-1", "ДУТ-2"]);
    });

    it("takes an object that is already disconnected, with its reason", async () => {
      const disconnectReasonId = await createReason(client);

      const id = await client.createObject({ status: "disconnected", disconnectReasonId });

      expect(await client.objectCard(id)).toMatchObject({
        status: "disconnected",
        disconnectedOn: MONTH_AGO,
        disconnectReasonName: "Причина",
      });
      expect(await clientCard()).toMatchObject({ objectsDisconnected: 1, status: "disconnected" });
    });
  });

  describe("the list", () => {
    it("finds an object by its name, tracker, SIM and client", async () => {
      const imei = nextImei();
      const iccid = nextIccid();
      await client.createObject({
        name: "Вантажівка",
        device: { imei },
        sim: { iccid, msisdn: "0671234567" },
      });
      await client.createObject({ name: "Трактор" });
      const code = (await clientCard()).code;

      expect(await names("q=Вантаж")).toEqual(["Вантажівка"]);
      expect(await names(`q=${imei.slice(-6)}`)).toEqual(["Вантажівка"]);
      expect(await names(`q=${iccid}`)).toEqual(["Вантажівка"]);
      expect(await names("q=1234567")).toEqual(["Вантажівка"]);
      expect(await names(`q=${code}`)).toHaveLength(2);
    });

    it("filters by what the object stands on", async () => {
      const place = await createPlace(client, "Програма 2", "Сервер 2");
      const tariffId = await createTariff(client, place, { name: "Тариф 2" });
      const modelId = await client.create("/tracker-models", { name: "Модель 1" });
      const addonId = await createAddon(client, [client.place.programId]);
      await client.createObject({
        name: "Своя",
        ownTariff: { programId: place.programId, tariffId, validFrom: MONTH_AGO },
        device: { imei: nextImei(), modelId },
      });
      await client.createObject({
        name: "З послугою",
        addons: [{ addonId, validFrom: MONTH_AGO }],
        status: "suspended",
      });

      expect(await names(`programId=${place.programId}`)).toEqual(["Своя"]);
      expect(await names(`serverId=${place.serverId}`)).toEqual(["Своя"]);
      expect(await names(`tariffId=${tariffId}`)).toEqual(["Своя"]);
      expect(await names(`modelId=${modelId}`)).toEqual(["Своя"]);
      expect(await names(`addonId=${addonId}`)).toEqual(["З послугою"]);
      expect(await names("status=suspended")).toEqual(["З послугою"]);
    });

    it("filters by the client and its manager", async () => {
      await client.createObject({ name: "Своя" });
      const { managerId } = await clientCard();
      const other = await client.createClient({ name: "Інший" });
      const [payer] = await client.payersOf(other.id);
      await client.createObject({ name: "Чужа", subscriberId: other.id, payerId: payer?.id });

      expect(await names(`subscriberId=${other.id}`)).toEqual(["Чужа"]);
      expect(await names(`managerId=${managerId}`)).toHaveLength(2);
      expect(await names(`managerId=${UNKNOWN_ID}`)).toEqual([]);
    });

    it("sorts and pages by each column without a repeat", async () => {
      for (const [name, connectedOn] of [
        ["Бета", WEEK_AGO],
        ["Альфа", MONTH_AGO],
        ["Гама", YESTERDAY],
      ] as const) {
        await client.createObject({ name, connectedOn, statusFrom: connectedOn, installedOn: connectedOn });
      }

      const walk = async (query: string) => {
        const seen: string[] = [];
        let cursor = "";
        do {
          const page = (await client.call("GET", `/objects?limit=2&${query}${cursor}`)).json<ObjectList>();
          seen.push(...page.items.map((row) => row.name));
          cursor = page.nextCursor ? `&cursor=${encodeURIComponent(page.nextCursor)}` : "";
        } while (cursor);
        return seen;
      };

      expect(await walk("sort=name&order=asc")).toEqual(["Альфа", "Бета", "Гама"]);
      expect(await walk("sort=connectedOn&order=desc")).toEqual(["Гама", "Бета", "Альфа"]);
      expect(await walk("sort=createdAt&order=desc")).toEqual(["Гама", "Альфа", "Бета"]);
      expect(await walk("sort=subscriber&order=asc")).toHaveLength(3);
    });

    it("counts the same way it lists", async () => {
      await client.createObject();
      await client.createObject({ status: "suspended" });

      expect(await countOf("status=suspended")).toEqual({ count: 1, isCapped: false });
    });

    it("costs the same number of queries on a page of 25 and of 100", async () => {
      const addonId = await createAddon(client, [client.place.programId]);
      for (let index = 0; index <= BIG_PAGE; index += 1) {
        await client.createObject({ name: `Об'єкт ${index}`, addons: [{ addonId, validFrom: MONTH_AGO }] });
      }
      const { db: counted, statements } = createStatementLog(testAppDatabaseUrl());
      const query = { limit: SMALL_PAGE, sort: "createdAt", order: "desc" } as const;
      try {
        await listObjects(counted, query, ALL_RECORDS);
        const atSmall = statements.length;
        statements.length = 0;
        await listObjects(counted, { ...query, limit: BIG_PAGE }, ALL_RECORDS);

        expect(statements.length).toBe(atSmall);
      } finally {
        await counted.$disconnect();
      }
    });
  });

  describe("the card", () => {
    it("shows the tariff of today, and the one a client has planned", async () => {
      const running = await client.createClient({ name: "Давній", tariffValidFrom: MONTH_AGO });
      const [payer] = await client.payersOf(running.id);
      const id = await client.createObject({ subscriberId: running.id, payerId: payer?.id });
      const tariffId = await createTariff(client, client.place, { name: "Тариф 2" });
      await client.call("POST", `/subscribers/${running.id}/tariff`, {
        programId: client.place.programId,
        tariffId,
        validFrom: NEXT_MONTH,
      });

      expect(await client.objectCard(id)).toMatchObject({
        tariff: { tariffId: client.tariffId },
        nextTariff: { tariffId, validFrom: NEXT_MONTH, isOwn: false },
      });
    });

    it("answers 404 for an unknown id, in the history and the journal as well", async () => {
      expect((await client.call("GET", `/objects/${UNKNOWN_ID}`)).statusCode).toBe(404);
      expect((await client.call("GET", `/objects/${UNKNOWN_ID}/history`)).statusCode).toBe(404);
      expect((await client.call("GET", `/objects/${UNKNOWN_ID}/activity`)).statusCode).toBe(404);
    });

    it("keeps the journal of the object in one place", async () => {
      const id = await client.createObject();
      await client.call("PATCH", `/objects/${id}`, {
        name: "Нова назва",
        note: null,
        version: (await client.objectCard(id)).version,
      });

      const lines = items<{ action: string }>(await client.call("GET", `/objects/${id}/activity`));

      expect(lines.map((line) => line.action)).toEqual(
        expect.arrayContaining(["object.updated", "object.created", "device.installed", "sim.installed"]),
      );
    });
  });

  describe("a change of the record", () => {
    it("refuses a stale form", async () => {
      const id = await client.createObject();
      const { version } = await client.objectCard(id);
      await client.call("PATCH", `/objects/${id}`, { name: "Перша", note: null, version });

      const response = await client.call("PATCH", `/objects/${id}`, { name: "Друга", note: null, version });

      expect(response.json()).toMatchObject({ code: "version_conflict" });
    });

    it("leaves a form open across a change of status", async () => {
      const id = await client.createObject();
      const { version } = await client.objectCard(id);
      await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: TODAY });

      const response = await client.call("PATCH", `/objects/${id}`, { name: "Нова", note: null, version });

      expect(response.statusCode).toBe(204);
    });
  });

  describe("access", () => {
    const OWN_KEYS = [
      "subscribers.read",
      "subscribers.write",
      "objects.read",
      "objects.write",
      "objects.status.change",
    ];

    async function foreignObject(): Promise<string> {
      const id = await client.createObject({ name: "Чужий" });
      const stranger = await owner.user.create({
        data: {
          email: `stranger-${id}@example.test`,
          fullName: "Інший менеджер",
          status: "active",
          role: { connect: { key: "manager" } },
        },
      });
      await owner.subscriber.update({ where: { id: client.subscriberId }, data: { managerId: stranger.id } });
      return id;
    }

    async function asOwn(work: () => Promise<void>): Promise<void> {
      for (const key of OWN_KEYS) await setScope(owner, key, "own");
      try {
        await work();
      } finally {
        for (const key of OWN_KEYS) await setScope(owner, key, "all");
      }
    }

    it("hides an object of another manager at the level `own`", async () => {
      const id = await foreignObject();

      await asOwn(async () => {
        expect(await names()).toEqual([]);
        expect((await client.call("GET", `/objects/${id}`)).statusCode).toBe(404);
        expect((await client.call("GET", `/objects/${id}/history`)).statusCode).toBe(404);
        const change = await client.call("POST", `/objects/${id}/status`, { status: "suspended", validFrom: TODAY });
        expect(change.statusCode).toBe(404);
      });
    });

    it("does not let `equipment.write` reach past the level of the objects", async () => {
      const id = await foreignObject();

      await asOwn(async () => {
        const response = await client.call("POST", `/objects/${id}/sensors`, {
          sensor: { serialNo: "ДУТ-1" },
          installedOn: TODAY,
        });
        expect(response.statusCode).toBe(404);
      });
    });

    it("holds to the narrower of seeing and changing objects", async () => {
      const id = await foreignObject();
      await setScope(owner, "objects.write", "own");

      try {
        const response = await client.call("POST", `/objects/${id}/sensors`, {
          sensor: { serialNo: "ДУТ-2" },
          installedOn: TODAY,
        });
        expect(response.statusCode).toBe(404);
      } finally {
        await setScope(owner, "objects.write", "all");
      }
    });

    it("does not name an object of another manager in a refusal", async () => {
      const imei = nextImei();
      await client.createObject({ name: "Таємний", device: { imei } });
      const own = await client.createClient({ name: "Свій" });
      const [payer] = await client.payersOf(own.id);
      const stranger = await owner.user.create({
        data: {
          email: "stranger-name@example.test",
          fullName: "Інший менеджер",
          status: "active",
          role: { connect: { key: "manager" } },
        },
      });
      await owner.subscriber.update({ where: { id: client.subscriberId }, data: { managerId: stranger.id } });

      await asOwn(async () => {
        const form = client.objectForm({ subscriberId: own.id, payerId: payer?.id, device: { imei } });
        const response = await client.call("POST", "/objects", form);
        expect(response.statusCode).toBe(409);
        expect(response.body).not.toContain("Таємний");
      });
    });

    it("closes the routes without their permissions", async () => {
      const id = await client.createObject();

      await withoutPermission(owner, "objects.read", async () => {
        expect((await client.call("GET", "/objects")).statusCode).toBe(403);
      });
      await withoutPermission(owner, "objects.write", async () => {
        expect((await client.call("POST", "/objects", client.objectForm())).statusCode).toBe(403);
      });
      await withoutPermission(owner, "equipment.write", async () => {
        const body = { device: { imei: nextImei() }, installedOn: TODAY, moveSim: true };
        expect((await client.call("POST", `/objects/${id}/replace-device`, body)).statusCode).toBe(403);
      });
      await withoutPermission(owner, "records.archive", async () => {
        expect((await client.call("POST", `/objects/${id}/archive`, {})).statusCode).toBe(403);
      });
      await withoutPermission(owner, "records.delete", async () => {
        expect((await client.call("DELETE", `/objects/${id}`)).statusCode).toBe(403);
      });
    });
  });
});
