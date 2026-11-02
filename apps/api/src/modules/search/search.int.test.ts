import { addDays, type Home, type SearchResult } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isTimedOut, type DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { createUser } from "../../test-auth.js";
import { resetObjects, setScope, startObjectApi, TODAY, type ObjectApi } from "../../test-objects.js";
import { withoutPermission } from "../../test-references.js";
import { limitStatementTime } from "./search.queries.js";

const IMEI = "356938035643809";
const ICCID = "8938003990000012345";
const PHONE = "0501112233";

describe("the global search", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ObjectApi;
  let clientCode: number;
  let objectId: string;

  const search = async (query: string, archived = false): Promise<SearchResult> => {
    const params = new URLSearchParams({ q: query, ...(archived ? { archived: "true" } : {}) });
    const response = await client.call("GET", `/search?${params.toString()}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<SearchResult>();
  };
  const ids = (group: { items: { id: string }[] } | null) => group?.items.map((item) => item.id) ?? null;

  beforeAll(async () => {
    client = await startObjectApi(db, owner);
  });

  beforeEach(async () => {
    await resetObjects(client, owner);
    clientCode = (await client.card(client.subscriberId)).code;
    objectId = await client.createObject({ name: "Самоскид", device: { imei: IMEI }, sim: { iccid: ICCID } });
  });

  afterAll(async () => {
    await client.app.close();
    await db.$disconnect();
    await owner.$disconnect();
  });

  it("finds an object, its tracker and its client by the last six digits of the IMEI", async () => {
    const result = await search(IMEI.slice(-6));

    expect(ids(result.objects)).toEqual([objectId]);
    expect(result.devices?.items.map((device) => [device.imei, device.objectId])).toEqual([[IMEI, objectId]]);
    expect(ids(result.clients)).toEqual([client.subscriberId]);
    expect(result.sims?.items).toEqual([]);
  });

  it("finds by the last four digits and by the start of an IMEI, and a SIM by its ICCID", async () => {
    expect(ids((await search(IMEI.slice(-4))).objects)).toEqual([objectId]);
    expect(ids((await search(IMEI.slice(0, 8))).objects)).toEqual([objectId]);
    const bySim = await search(ICCID.slice(-6));
    expect(bySim.sims?.items.map((sim) => [sim.iccid, sim.deviceImei, sim.objectId])).toEqual([
      [ICCID, IMEI, objectId],
    ]);
  });

  it("finds a client and its contact by a phone, written in full or by its last digits", async () => {
    const other = await client.createClient({
      name: "Інший клієнт",
      contact: { fullName: "Петро Шукач", phone: PHONE, channel: "email", email: "p@example.test" },
    });

    for (const query of [PHONE.slice(-7), "+38 (050) 111-22-33"]) {
      const result = await search(query);
      expect(ids(result.clients)).toEqual([other.id]);
      expect(result.contacts?.items.map((contact) => [contact.fullName, contact.subscriberId])).toEqual([
        ["Петро Шукач", other.id],
      ]);
    }
  });

  it("finds a client by its new ID and by its old number, and a name from three letters", async () => {
    const old = await client.createClient({ name: "Старий клієнт", legacyCode: "А-17/2" });

    expect(ids((await search(String(clientCode))).clients)).toEqual([client.subscriberId]);
    expect(ids((await search("А-17/2")).clients)).toEqual([old.id]);
    const byName = await search("стар");
    expect(ids(byName.clients)).toEqual([old.id]);
    expect(byName.devices).toBeNull();
    expect(ids((await search("самоск")).objects)).toEqual([objectId]);
    expect(ids((await search("ст")).clients)).toEqual([]);
  });

  it("leaves the archive out unless asked, and then shows it after the live ones", async () => {
    const live = await client.createClient({ name: "Ромашка жива" });
    const gone = await client.createClient({ name: "Ромашка стара" });
    expect((await client.call("POST", `/subscribers/${gone.id}/archive`, {})).statusCode).toBe(204);

    expect(ids((await search("ромашка")).clients)).toEqual([live.id]);
    const withArchive = await search("ромашка", true);
    expect(withArchive.clients?.items.map((row) => [row.id, row.isArchived])).toEqual([
      [live.id, false],
      [gone.id, true],
    ]);
  });

  it("shows five in a group and says there are more", async () => {
    for (let index = 1; index <= 6; index += 1) await client.createClient({ name: `Група ${index}` });

    const result = await search("група");
    expect(result.clients?.items).toHaveLength(5);
    expect(result.clients?.hasMore).toBe(true);
  });

  it("leaves out the groups the person may not see", async () => {
    const result = await withoutPermission(owner, "objects.read", () =>
      withoutPermission(owner, "equipment.read", () => search(IMEI.slice(-6))),
    );

    expect(result.objects).toBeNull();
    expect(result.devices).toBeNull();
    expect(result.sims).toBeNull();
    expect(ids(result.clients)).toEqual([client.subscriberId]);
  });

  it("shows only the person's own clients, contacts and objects at the level `own`", async () => {
    const other = await createUser(owner, { email: "other@example.test" });
    await client.createClient({ name: "Чужий клієнт", managerId: other.id });
    await setScope(owner, "subscribers.read", "own");
    try {
      expect(ids((await search("чужий")).clients)).toEqual([]);
      await owner.subscriber.update({ where: { id: client.subscriberId }, data: { managerId: other.id } });
      await setScope(owner, "objects.read", "own");
      expect(ids((await search(IMEI.slice(-6))).objects)).toEqual([]);
      expect(ids((await search(PHONE.slice(-7))).contacts)).toEqual([]);
    } finally {
      await setScope(owner, "subscribers.read", "all");
      await setScope(owner, "objects.read", "all");
    }
  });

  it("refuses an empty query and one without the permission", async () => {
    expect((await client.call("GET", "/search?q=")).statusCode).toBe(400);
    const response = await withoutPermission(owner, "subscribers.read", () => client.call("GET", "/search?q=abc"));
    expect(response.statusCode).toBe(403);
  });

  it("knows a statement cut by its time limit", async () => {
    const error = await db
      .$transaction(async (tx) => {
        await limitStatementTime(tx, 50);
        await tx.$queryRaw`SELECT pg_sleep(1)`;
      })
      .catch((caught: unknown) => caught);

    expect(isTimedOut(error)).toBe(true);
  });
});

describe("the start page", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ObjectApi;

  const home = async (): Promise<Home> => {
    const response = await client.call("GET", "/home");
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Home>();
  };

  beforeAll(async () => {
    client = await startObjectApi(db, owner);
  });

  beforeEach(async () => {
    await resetObjects(client, owner);
    await owner.activityEvent.deleteMany();
  });

  afterAll(async () => {
    await client.app.close();
    await db.$disconnect();
    await owner.$disconnect();
  });

  it("counts and lists at the level `own` only the person's records", async () => {
    await client.createObject();
    const other = await createUser(owner, { email: "other@example.test" });
    await owner.subscriber.update({ where: { id: client.subscriberId }, data: { managerId: other.id } });
    await setScope(owner, "subscribers.read", "own");
    await setScope(owner, "objects.read", "own");
    try {
      const { counts, recentRecords } = await home();
      expect(counts.clients.count).toBe(0);
      expect(counts.activeObjects?.count).toBe(0);
      expect(recentRecords).toEqual([]);
    } finally {
      await setScope(owner, "subscribers.read", "all");
      await setScope(owner, "objects.read", "all");
    }
  });

  it("counts the live clients, the active objects and the contracts about to end", async () => {
    await client.createObject();
    await client.createObject({ status: "suspended" });
    const gone = await client.createClient({ name: "В архів" });
    await client.call("POST", `/subscribers/${gone.id}/archive`, {});
    const contract = { payerId: client.payerId, signedOn: addDays(TODAY, -100) };
    await client.call("POST", `/subscribers/${client.subscriberId}/contracts`, {
      ...contract,
      number: "1/26",
      validUntil: addDays(TODAY, 10),
    });
    await client.call("POST", `/subscribers/${client.subscriberId}/contracts`, {
      ...contract,
      number: "2/26",
      validUntil: addDays(TODAY, 200),
    });

    const { counts } = await home();
    expect(counts).toEqual({
      clients: { count: 1, isCapped: false },
      activeObjects: { count: 1, isCapped: false },
      expiringContracts: { count: 1, isCapped: false },
    });
  });

  it("lists what the person changed last, newest first and each record once", async () => {
    const objectId = await client.createObject({ name: "Тягач" });
    const second = await client.createClient({ name: "Другий клієнт" });
    await client.addPayer("Ще один платник");

    const { recentRecords } = await home();
    expect(recentRecords.map((record) => [record.kind, record.id])).toEqual([
      ["subscriber", client.subscriberId],
      ["subscriber", second.id],
      ["object", objectId],
    ]);
    expect(recentRecords[2]).toMatchObject({ name: "Тягач", isArchived: false });
  });

  it("shows the last changes of the system only to whoever reads the journal", async () => {
    await client.createClient({ name: "Подія" });

    expect((await home()).recentActivity?.map((event) => event.action)).toContain("subscriber.created");
    const withoutJournal = await withoutPermission(owner, "activity.read", home);
    expect(withoutJournal.recentActivity).toBeNull();
    const withoutObjects = await withoutPermission(owner, "objects.read", home);
    expect(withoutObjects.counts.activeObjects).toBeNull();
  });
});
