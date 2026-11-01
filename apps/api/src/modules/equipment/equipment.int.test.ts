import type { DeviceCard, DeviceRow, EquipmentCheck, SensorRow, SimCard, SimRow } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import {
  MONTH_AGO,
  nextIccid,
  nextImei,
  resetObjects,
  setScope,
  startObjectApi,
  TODAY,
  type ObjectApi,
} from "../../test-objects.js";
import { items, withoutPermission } from "../../test-references.js";

const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";
const VALID_IMEI = "490154203237518";
const WRONG_CHECK_DIGIT = "490154203237519";

describe("equipment", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ObjectApi;

  const devices = async (query = "") => items<DeviceRow>(await client.call("GET", `/devices?${query}`));
  const sims = async (query = "") => items<SimRow>(await client.call("GET", `/sims?${query}`));
  const sensors = async (query = "") => items<SensorRow>(await client.call("GET", `/sensors?${query}`));
  const created = (body: string) => (JSON.parse(body) as { id: string }).id;

  async function registerDevice(fields: object = {}): Promise<string> {
    const response = await client.call("POST", "/devices", { imei: nextImei(), ...fields });
    expect(response.statusCode).toBe(201);
    return created(response.body);
  }

  async function registerSim(fields: object = {}): Promise<string> {
    const response = await client.call("POST", "/sims", { iccid: nextIccid(), ...fields });
    expect(response.statusCode).toBe(201);
    return created(response.body);
  }

  async function registerSensor(fields: object = {}): Promise<string> {
    const response = await client.call("POST", "/sensors", { serialNo: "ДУТ-1", ...fields });
    expect(response.statusCode).toBe(201);
    return created(response.body);
  }

  const deviceCard = async (id: string) => (await client.call("GET", `/devices/${id}`)).json<DeviceCard>();
  const simCard = async (id: string) => (await client.call("GET", `/sims/${id}`)).json<SimCard>();

  function deviceUpdate(card: DeviceCard, fields: object = {}) {
    const { imei, modelId, ownership, status, note, version } = card;
    return { imei, modelId, ownership, status, note, version, ...fields };
  }

  function simUpdate(card: SimCard, fields: object = {}) {
    const { iccid, msisdn, operatorId, planId, status, note, version } = card;
    return { iccid, msisdn, operatorId, planId, status, note, version, ...fields };
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

  describe("registration", () => {
    it("takes a tracker without an object: the date comes with the installation", async () => {
      const modelId = await client.create("/tracker-models", { name: "Модель 1" });

      const id = await registerDevice({ imei: "4901 5420-3237 518", modelId, ownership: "rented", note: "У техніка" });

      expect(await deviceCard(id)).toMatchObject({
        imei: VALID_IMEI,
        modelName: "Модель 1",
        ownership: "rented",
        status: "removed",
        note: "У техніка",
        place: null,
        history: [],
      });
      expect(await client.journal("device.created")).toMatchObject([{ entityId: id, entityLabel: VALID_IMEI }]);
    });

    it("refuses a number that is not 15 digits", async () => {
      const response = await client.call("POST", "/devices", { imei: "12345" });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("15 цифр");
    });

    it("says a number is taken, by the field", async () => {
      await registerDevice({ imei: VALID_IMEI });

      const response = await client.call("POST", "/devices", { imei: VALID_IMEI });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "imei_taken",
        fieldErrors: { imei: "Трекер з таким IMEI уже є" },
      });
    });

    it("sends a number from the archive back to the archive", async () => {
      const id = await registerDevice({ imei: VALID_IMEI });
      await client.call("POST", `/devices/${id}/archive`, {});

      const response = await client.call("POST", "/devices", { imei: VALID_IMEI });

      expect(response.json()).toMatchObject({
        fieldErrors: { imei: "Трекер з таким IMEI є в архіві: відновіть його" },
      });
    });

    it("refuses a model that was deactivated", async () => {
      const response = await client.call("POST", "/devices", { imei: nextImei(), modelId: UNKNOWN_ID });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ fieldErrors: { modelId: "Оберіть модель" } });
    });

    it("takes a SIM with its operator and plan, and keeps the number in one format", async () => {
      const operatorId = await client.create("/sim-operators", { name: "Оператор 1" });
      const planId = await client.create("/sim-plans", { operatorId, name: "План 1" });

      const id = await registerSim({ msisdn: "067 123 45 67", operatorId, planId });

      expect(await simCard(id)).toMatchObject({
        msisdn: "+380671234567",
        operatorName: "Оператор 1",
        planName: "План 1",
        status: "free",
      });
    });

    it("refuses a plan of another operator", async () => {
      const operatorId = await client.create("/sim-operators", { name: "Оператор 1" });
      const otherId = await client.create("/sim-operators", { name: "Оператор 2" });
      const planId = await client.create("/sim-plans", { operatorId, name: "План 1" });

      const response = await client.call("POST", "/sims", { iccid: nextIccid(), operatorId: otherId, planId });

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ fieldErrors: { planId: "Оберіть тариф цього оператора" } });
    });

    it("tells a taken ICCID from a taken number", async () => {
      const iccid = nextIccid();
      await registerSim({ iccid, msisdn: "0671234567" });

      const sameIccid = await client.call("POST", "/sims", { iccid });
      const sameNumber = await client.call("POST", "/sims", { iccid: nextIccid(), msisdn: "0671234567" });

      expect(sameIccid.json()).toMatchObject({ code: "iccid_taken" });
      expect(sameNumber.json()).toMatchObject({
        code: "msisdn_taken",
        fieldErrors: { msisdn: "Цей номер уже в іншої SIM" },
      });
    });

    it("takes a sensor by its serial number, once", async () => {
      await registerSensor();

      const response = await client.call("POST", "/sensors", { serialNo: "ДУТ-1" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "serial_taken" });
    });
  });

  describe("lists", () => {
    it("finds a tracker by how the number starts and ends, and not by a piece too short", async () => {
      await registerDevice({ imei: VALID_IMEI });
      await registerDevice();

      expect(await devices("q=7518")).toHaveLength(1);
      expect(await devices("q=4901")).toHaveLength(1);
      expect(await devices("q=518")).toHaveLength(0);
    });

    it("finds a SIM by ICCID and by the end of its number", async () => {
      const iccid = nextIccid();
      await registerSim({ iccid, msisdn: "0671234567" });
      await registerSim();

      expect(await sims(`q=${iccid}`)).toHaveLength(1);
      expect(await sims("q=1234567")).toHaveLength(1);
    });

    it("finds a sensor by a piece of its number", async () => {
      await registerSensor({ serialNo: "AB-123" });

      expect(await sensors("q=b-1")).toHaveLength(1);
      expect(await sensors("q=xyz")).toHaveLength(0);
    });

    it("shows where a tracker stands and who put it there", async () => {
      const contractorId = await client.create("/contractors", { name: "Підрядник 1" });
      const objectId = await client.createObject({ name: "Вантажівка", contractorId });

      const [row] = await devices("status=installed");

      expect(row?.place).toMatchObject({
        objectId,
        objectName: "Вантажівка",
        subscriberId: client.subscriberId,
        installedOn: MONTH_AGO,
        contractorName: "Підрядник 1",
      });
      expect(await devices(`contractorId=${contractorId}`)).toHaveLength(1);
      expect(await devices(`contractorId=${UNKNOWN_ID}`)).toHaveLength(0);
    });

    it("pages by the id, newest first", async () => {
      const first = await registerDevice();
      const second = await registerDevice();
      const third = await registerDevice();

      const page = (await client.call("GET", "/devices?limit=2")).json<{ items: DeviceRow[]; nextCursor: string }>();
      const rest = await devices(`limit=2&cursor=${page.nextCursor}`);

      expect(page.items.map((row) => row.id)).toEqual([third, second]);
      expect(rest.map((row) => row.id)).toEqual([first]);
    });

    it("finds nothing by too short a number, also from the middle of a list", async () => {
      await registerDevice();
      const newest = await registerDevice();

      const found = await client.call("GET", "/devices/available?q=12");
      const fromCursor = await client.call("GET", `/devices/available?q=12&cursor=${newest}`);

      expect(items<DeviceRow>(found)).toEqual([]);
      expect(items<DeviceRow>(fromCursor)).toEqual([]);
    });

    it("offers only what is free to a form", async () => {
      const free = await registerDevice();
      const inRepair = await registerDevice();
      await client.call(
        "PATCH",
        `/devices/${inRepair}`,
        deviceUpdate(await deviceCard(inRepair), { status: "repair" }),
      );
      const freeSim = await registerSim();
      const freeSensor = await registerSensor();
      await client.createObject({ sensors: [{ sensor: { serialNo: "ДУТ-2" }, installedOn: MONTH_AGO }] });

      const available = items<DeviceRow>(await client.call("GET", "/devices/available"));
      const availableSims = items<SimRow>(await client.call("GET", "/sims/available"));
      const availableSensors = items<SensorRow>(await client.call("GET", "/sensors/available"));

      expect(available.map((row) => row.id)).toEqual([free]);
      expect(availableSims.map((row) => row.id)).toEqual([freeSim]);
      expect(availableSensors.map((row) => row.id)).toEqual([freeSensor]);
    });
  });

  describe("cards", () => {
    it("keeps the installations of a tracker, newest first", async () => {
      const contractorId = await client.create("/contractors", { name: "Підрядник 1" });
      const id = await registerDevice();
      const objectId = await client.createObject({ name: "Вантажівка", device: { deviceId: id }, contractorId });

      expect((await deviceCard(id)).history).toMatchObject([
        { validFrom: MONTH_AGO, validTo: null, contractorName: "Підрядник 1", label: "Вантажівка", objectId },
      ]);
    });

    it("names the object a SIM stood on through its tracker", async () => {
      const simId = await registerSim();
      const objectId = await client.createObject({ name: "Вантажівка", sim: { simId } });

      const card = await simCard(simId);

      expect(card.status).toBe("active");
      expect(card.history[0]).toMatchObject({ objectId, validFrom: MONTH_AGO });
      expect(card.history[0]?.label).toContain("Вантажівка");
    });

    it("reads the cost of a plan from the list of plans, and only for who may see costs", async () => {
      const operatorId = await client.create("/sim-operators", { name: "Оператор 1" });
      const planId = await client.create("/sim-plans", { operatorId, name: "План 1" });
      await client.post("/cost-prices", {
        subjectType: "sim_plan",
        subjectId: planId,
        amountKop: 5_000,
        validFrom: TODAY,
      });
      const id = await registerSim({ operatorId, planId });

      expect((await simCard(id)).planCostKop).toBe(5_000);
      await withoutPermission(owner, "cost.read", async () => {
        expect((await simCard(id)).planCostKop).toBeNull();
      });
    });

    it("answers 404 for an unknown id", async () => {
      expect((await client.call("GET", `/devices/${UNKNOWN_ID}`)).statusCode).toBe(404);
      expect((await client.call("GET", `/sims/${UNKNOWN_ID}`)).statusCode).toBe(404);
    });
  });

  describe("checks while typing", () => {
    const check = async (path: string) => (await client.call("GET", path)).json<EquipmentCheck>();

    it("warns about the check digit and lets it pass", async () => {
      expect(await check(`/devices/imei-check?value=${WRONG_CHECK_DIGIT}`)).toMatchObject({
        isValid: true,
        isFree: true,
        hasChecksumWarning: true,
      });
      expect(await check(`/devices/imei-check?value=${VALID_IMEI}`)).toMatchObject({ hasChecksumWarning: false });
    });

    it("names who holds a number", async () => {
      const imei = nextImei();
      const objectId = await client.createObject({ name: "Вантажівка", device: { imei } });

      expect(await check(`/devices/imei-check?value=${imei}`)).toMatchObject({
        isFree: false,
        holder: { objectId, label: "Вантажівка", isArchived: false },
      });
    });

    it("does not count the record itself", async () => {
      const id = await registerDevice({ imei: VALID_IMEI });

      expect(await check(`/devices/imei-check?value=${VALID_IMEI}&excludeId=${id}`)).toMatchObject({ isFree: true });
    });

    it("takes half a number as not valid yet", async () => {
      expect(await check("/devices/imei-check?value=123")).toMatchObject({ isValid: false, isFree: false });
      expect(await check("/sims/iccid-check?value=123")).toMatchObject({ isValid: false, isFree: false });
    });

    it("names the tracker a SIM stands in", async () => {
      const iccid = nextIccid();
      const imei = nextImei();
      await client.createObject({ device: { imei }, sim: { iccid } });

      expect(await check(`/sims/iccid-check?value=${iccid}`)).toMatchObject({
        isFree: false,
        holder: { label: `Трекер ${imei}` },
      });
    });
  });

  describe("changes", () => {
    it("writes data and a state as two lines of the journal", async () => {
      const id = await registerDevice();
      const update = deviceUpdate(await deviceCard(id), { note: "Перевірити", status: "repair" });

      const response = await client.call("PATCH", `/devices/${id}`, update);

      expect(response.statusCode).toBe(204);
      expect(await deviceCard(id)).toMatchObject({ note: "Перевірити", status: "repair" });
      expect(await client.journal("device.updated")).toHaveLength(1);
      expect(await client.journal("device.state_changed")).toMatchObject([
        { changes: [{ field: "status", before: "removed", after: "repair" }] },
      ]);
    });

    it("refuses a stale form", async () => {
      const id = await registerDevice();
      const stale = deviceUpdate(await deviceCard(id), { note: "Перша" });
      await client.call("PATCH", `/devices/${id}`, stale);

      const response = await client.call("PATCH", `/devices/${id}`, { ...stale, note: "Друга" });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "version_conflict" });
    });

    it("gives a number taken by a change the words of a taken number", async () => {
      await registerDevice({ imei: VALID_IMEI });
      const id = await registerDevice();

      const response = await client.call(
        "PATCH",
        `/devices/${id}`,
        deviceUpdate(await deviceCard(id), { imei: VALID_IMEI }),
      );

      expect(response.json()).toMatchObject({ code: "imei_taken" });
    });

    it("keeps `installed` to the actions of an object", async () => {
      const id = await registerDevice();
      const response = await client.call(
        "PATCH",
        `/devices/${id}`,
        deviceUpdate(await deviceCard(id), { status: "installed" }),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "state_refused" });
    });

    it("does not take a tracker off an object by a change of state", async () => {
      const id = await registerDevice();
      await client.createObject({ device: { deviceId: id } });

      const response = await client.call(
        "PATCH",
        `/devices/${id}`,
        deviceUpdate(await deviceCard(id), { status: "repair" }),
      );

      expect(response.statusCode).toBe(409);
      expect(response.body).toContain("стоїть на об'єкті");
    });

    it("lets a SIM in a tracker be blocked, not freed", async () => {
      const id = await registerSim();
      await client.createObject({ sim: { simId: id } });

      const freed = await client.call("PATCH", `/sims/${id}`, simUpdate(await simCard(id), { status: "free" }));
      const blocked = await client.call("PATCH", `/sims/${id}`, simUpdate(await simCard(id), { status: "blocked" }));

      expect(freed.statusCode).toBe(409);
      expect(blocked.statusCode).toBe(204);
    });

    it("keeps `active` to a SIM in a tracker", async () => {
      const id = await registerSim();

      const response = await client.call("PATCH", `/sims/${id}`, simUpdate(await simCard(id), { status: "active" }));

      expect(response.statusCode).toBe(409);
    });

    it("changes a sensor and keeps a stale form out", async () => {
      const id = await registerSensor();
      const [row] = await sensors();

      const response = await client.call("PATCH", `/sensors/${id}`, {
        serialNo: "ДУТ-9",
        note: "Новий",
        version: row?.version,
      });
      const stale = await client.call("PATCH", `/sensors/${id}`, {
        serialNo: "ДУТ-8",
        note: null,
        version: row?.version,
      });

      expect(response.statusCode).toBe(204);
      expect(stale.statusCode).toBe(409);
      expect((await sensors())[0]).toMatchObject({ serialNo: "ДУТ-9", note: "Новий" });
    });
  });

  describe("archive and delete", () => {
    it("takes a free tracker to the archive and back", async () => {
      const id = await registerDevice();

      expect((await client.call("POST", `/devices/${id}/archive`, {})).statusCode).toBe(204);
      expect(await devices()).toHaveLength(0);
      expect(await devices("archived=true")).toHaveLength(1);
      expect((await client.call("POST", `/devices/${id}/restore`, {})).statusCode).toBe(204);
      expect(await devices()).toHaveLength(1);
      expect(await client.journal("device.archived")).toHaveLength(1);
      expect(await client.journal("device.restored")).toHaveLength(1);
    });

    it("brings a record back from the page of the archive as well", async () => {
      const id = await registerSim();
      await client.call("POST", `/sims/${id}/archive`, {});
      const [batch] = await owner.archiveBatch.findMany({ where: { entityType: "sim" } });

      const response = await client.call("POST", `/archive/${batch?.id}/restore`, {});

      expect(response.statusCode).toBe(204);
      expect(await sims()).toHaveLength(1);
    });

    it("keeps what stands on an object out of the archive", async () => {
      const deviceId = await registerDevice();
      const simId = await registerSim();
      await client.createObject({ device: { deviceId }, sim: { simId } });

      expect((await client.call("POST", `/devices/${deviceId}/archive`, {})).json()).toMatchObject({
        code: "equipment_installed",
      });
      expect((await client.call("POST", `/sims/${simId}/archive`, {})).statusCode).toBe(409);
    });

    it("refuses a change of a record in the archive", async () => {
      const id = await registerDevice();
      const update = deviceUpdate(await deviceCard(id));
      await client.call("POST", `/devices/${id}/archive`, {});

      const response = await client.call("PATCH", `/devices/${id}`, update);

      expect(response.json()).toMatchObject({ code: "record_archived" });
    });

    it("deletes a mistake that never stood anywhere", async () => {
      const id = await registerDevice();

      expect((await client.call("DELETE", `/devices/${id}`)).statusCode).toBe(204);
      expect(await devices()).toHaveLength(0);
      expect(await client.journal("device.deleted")).toHaveLength(1);
    });

    it("keeps one with a history", async () => {
      const reasonId = await client.create("/disconnect-reasons", { name: "Причина" });
      const deviceId = await registerDevice();
      const objectId = await client.createObject({ device: { deviceId } });
      await client.call("POST", `/objects/${objectId}/status`, {
        status: "disconnected",
        validFrom: TODAY,
        reasonId,
      });
      await client.call("POST", `/objects/${objectId}/archive`, {});

      const response = await client.call("DELETE", `/devices/${deviceId}`);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "equipment_has_history" });
    });

    it("answers 404 for an unknown record", async () => {
      expect((await client.call("POST", `/sensors/${UNKNOWN_ID}/archive`, {})).statusCode).toBe(404);
      expect((await client.call("POST", `/sensors/${UNKNOWN_ID}/restore`, {})).statusCode).toBe(404);
      expect((await client.call("DELETE", `/sims/${UNKNOWN_ID}`)).statusCode).toBe(404);
    });
  });

  describe("access", () => {
    it("closes the lists and the writes without their permissions", async () => {
      await withoutPermission(owner, "equipment.read", async () => {
        expect((await client.call("GET", "/devices")).statusCode).toBe(403);
        expect((await client.call("GET", "/sims/available")).statusCode).toBe(403);
      });
      await withoutPermission(owner, "equipment.write", async () => {
        expect((await client.call("POST", "/sensors", { serialNo: "ДУТ" })).statusCode).toBe(403);
      });
      await withoutPermission(owner, "records.delete", async () => {
        expect((await client.call("DELETE", `/devices/${UNKNOWN_ID}`)).statusCode).toBe(403);
      });
    });

    it("gives the level `own` nothing to archive: equipment is nobody's", async () => {
      const id = await registerDevice();
      await setScope(owner, "records.archive", "own");
      try {
        expect((await client.call("POST", `/devices/${id}/archive`, {})).statusCode).toBe(404);
      } finally {
        await setScope(owner, "records.archive", "all");
      }
    });
  });
});
