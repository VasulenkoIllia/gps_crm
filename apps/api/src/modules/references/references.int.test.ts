import { SIMPLE_REFERENCE_KINDS, type Server, type SimPlan, type SimpleReference } from "@gps_crm/shared";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase, testAppDatabaseUrl } from "../../core/db/test-database.js";
import { PrismaClient } from "../../generated/prisma/client.js";
import { api } from "../../test-auth.js";
import {
  clearReferences,
  createPlace,
  createTariff,
  items,
  seedSampleTable,
  startReferenceClient,
  withoutPermission,
  type ReferenceClient,
} from "./references.test-support.js";

const FIRST_COST = { amountKop: 4_500, validFrom: "2026-01-01" };
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

describe("the plain reference lists", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ReferenceClient;

  beforeAll(async () => {
    client = await startReferenceClient(db, owner);
  });

  beforeEach(() => clearReferences(owner));

  afterAll(async () => {
    await client.app.close();
    await clearReferences(owner);
    await owner.$disconnect();
    await db.$disconnect();
  });

  describe.each(SIMPLE_REFERENCE_KINDS)("/%s", (kind) => {
    const list = async () => items<SimpleReference>(await client.get(`/${kind}`));

    it("adds a value, changes it and writes both to the journal", async () => {
      const id = await client.create(`/${kind}`, { name: "  Значення  ", note: "Примітка", sortOrder: 3 });
      expect(await list()).toEqual([
        { id, version: 1, name: "Значення", note: "Примітка", sortOrder: 3, isActive: true },
      ]);

      const changed = await client.patch(`/${kind}/${id}`, { name: "Інше", note: null, sortOrder: 3, version: 1 });
      expect(changed.statusCode, changed.body).toBe(204);

      expect(await list()).toMatchObject([{ id, version: 2, name: "Інше", note: null }]);
      expect(await client.journal("reference.created")).toMatchObject([{ entityId: id, entityLabel: "Значення" }]);
      const [line] = await client.journal("reference.updated");
      expect(line).toMatchObject({ entityId: id, entityLabel: "Інше", details: [] });
      expect(line?.changes).toEqual([
        { field: "name", before: "Значення", after: "Інше" },
        { field: "note", before: "Примітка", after: null },
      ]);
    });

    it("takes the same name in another case for the same value", async () => {
      await client.create(`/${kind}`, { name: "Значення" });

      const again = await client.post(`/${kind}`, { name: " значення " });

      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ code: "name_taken", fieldErrors: { name: expect.any(String) as string } });
    });

    it("refuses a name made of spaces", async () => {
      const refused = await client.post(`/${kind}`, { name: "   " });

      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ code: "validation_failed", fieldErrors: { name: "Вкажіть назву" } });
    });

    it("does not overwrite what someone saved while the form stood open", async () => {
      const id = await client.create(`/${kind}`, { name: "Значення" });
      await client.patch(`/${kind}/${id}`, { name: "Перший", note: null, sortOrder: 0, version: 1 });

      const stale = await client.patch(`/${kind}/${id}`, { name: "Другий", note: null, sortOrder: 0, version: 1 });

      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ code: "version_conflict" });
      expect(await list()).toMatchObject([{ name: "Перший", version: 2 }]);
    });

    it("gives 404 for an id that is not there", async () => {
      const answer = await client.patch(`/${kind}/${UNKNOWN_ID}`, {
        name: "Назва",
        note: null,
        sortOrder: 0,
        version: 1,
      });
      expect(answer.statusCode).toBe(404);
    });

    it("writes nothing when nothing changed", async () => {
      const id = await client.create(`/${kind}`, { name: "Значення" });

      const same = await client.patch(`/${kind}/${id}`, { name: "Значення", note: null, sortOrder: 0, version: 1 });

      expect(same.statusCode).toBe(204);
      expect(await list()).toMatchObject([{ version: 1 }]);
      expect(await client.journal("reference.updated")).toEqual([]);
    });
  });

  describe("servers", () => {
    const list = async () => items<Server>(await client.get("/servers"));

    it("keeps a server with its program and the first cost of its licence", async () => {
      const programId = await client.create("/programs", { name: "Програма 1" });
      const id = await client.create("/servers", {
        programId,
        name: "Сервер 1",
        url: "https://server.example",
        firstCost: FIRST_COST,
      });

      expect(await list()).toEqual([
        {
          id,
          version: 1,
          name: "Сервер 1",
          isActive: true,
          programId,
          programName: "Програма 1",
          url: "https://server.example",
          costs: [{ id: expect.any(String) as string, ...FIRST_COST }],
        },
      ]);
      expect(await client.journal("reference.cost_added")).toMatchObject([
        { entityType: "monitoring_server", entityId: id, entityLabel: "Сервер 1" },
      ]);
    });

    it("allows one server name per program", async () => {
      const first = await createPlace(client, "Програма 1", "Сервер 1");
      const second = await client.create("/programs", { name: "Програма 2" });

      await client.create("/servers", { programId: second, name: "Сервер 1" });
      const again = await client.post("/servers", { programId: first.programId, name: "Сервер 1" });

      expect(again.statusCode).toBe(409);
      expect(again.json()).toMatchObject({ message: "Такий сервер у цій програмі вже є" });
    });

    it("needs a program that exists", async () => {
      const refused = await client.post("/servers", { programId: UNKNOWN_ID, name: "Сервер" });

      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ fieldErrors: { programId: "Оберіть програму" } });
    });

    it("moves to another program only while it has no tariffs", async () => {
      const place = await createPlace(client);
      const programId = await client.create("/programs", { name: "Програма 2" });
      const moved = await client.patch(`/servers/${place.serverId}`, {
        programId,
        name: "Сервер 1",
        url: null,
        version: 1,
      });
      expect(moved.statusCode, moved.body).toBe(204);
      expect((await client.journal("reference.updated"))[0]?.changes).toEqual([
        { field: "program", before: "Програма 1", after: "Програма 2" },
      ]);

      await createTariff(client, { programId, serverId: place.serverId });
      const refused = await client.patch(`/servers/${place.serverId}`, {
        programId: place.programId,
        name: "Сервер 1",
        url: null,
        version: 2,
      });
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: "server_has_tariffs" });
    });

    it("shows no cost to a person without `cost.read`, and says so with a null", async () => {
      const programId = await client.create("/programs", { name: "Програма 1" });
      await client.create("/servers", { programId, name: "Сервер 1", firstCost: FIRST_COST });

      const hidden = await withoutPermission(owner, "cost.read", list);

      expect(hidden).toMatchObject([{ name: "Сервер 1", costs: null }]);
      expect(JSON.stringify(hidden)).not.toContain(String(FIRST_COST.amountKop));
    });
  });

  describe("sim plans", () => {
    it("keeps a plan with its operator and what it costs us", async () => {
      const operatorId = await client.create("/sim-operators", { name: "Оператор" });
      const id = await client.create("/sim-plans", { operatorId, name: "Трекер 5", firstCost: FIRST_COST });

      const changed = await client.patch(`/sim-plans/${id}`, {
        operatorId,
        name: "Трекер 7",
        note: "Нова примітка",
        sortOrder: 2,
        version: 1,
      });
      expect(changed.statusCode, changed.body).toBe(204);

      expect(items<SimPlan>(await client.get("/sim-plans"))).toEqual([
        {
          id,
          version: 2,
          name: "Трекер 7",
          note: "Нова примітка",
          sortOrder: 2,
          isActive: true,
          operatorId,
          operatorName: "Оператор",
          costs: [{ id: expect.any(String) as string, ...FIRST_COST }],
        },
      ]);
    });

    it("needs an operator that works", async () => {
      const refused = await client.post("/sim-plans", { operatorId: UNKNOWN_ID, name: "Трекер 5" });
      expect(refused.json()).toMatchObject({ fieldErrors: { operatorId: "Оберіть оператора" } });
    });
  });

  describe("lists", () => {
    it("pages through a list in its own order without losing a row", async () => {
      for (const [index, name] of ["Ввв", "Ббб", "Ааа"].entries()) {
        await client.create("/contractors", { name, sortOrder: index === 0 ? 1 : 0 });
      }

      const first = (await client.get("/contractors?limit=2")).json<{
        items: { name: string }[];
        nextCursor: string;
      }>();
      expect(first.items.map(({ name }) => name)).toEqual(["Ааа", "Ббб"]);

      const second = await client.get(`/contractors?limit=2&cursor=${first.nextCursor}`);
      expect(second.json()).toMatchObject({ items: [{ name: "Ввв" }], nextCursor: null });
    });

    it("refuses a limit above the largest page and an unknown key", async () => {
      expect((await client.get("/contractors?limit=501")).statusCode).toBe(400);
      expect((await client.get("/contractors?sort=name")).statusCode).toBe(400);
    });

    it("costs the same number of queries at 25 and 100 rows", async () => {
      const counting = new PrismaClient({
        adapter: new PrismaPg({ connectionString: testAppDatabaseUrl() }),
        log: [{ emit: "event", level: "query" }],
      });
      let count = 0;
      counting.$on("query", () => {
        count += 1;
      });
      const countFor = async (limit: number) => {
        count = 0;
        const { listReferences } = await import("./references.service.js");
        const query = { limit };
        for (const kind of ["servers", "tariffs", "addons", "sim-plans"] as const) {
          await listReferences(counting, kind, query, true);
        }
        return count;
      };
      await seedManyRows(client);

      const small = await countFor(25);
      const large = await countFor(100);
      await counting.$disconnect();

      expect(large).toBe(small);
    });

    it("holds a whole sample of the references", async () => {
      await seedSampleTable(client);

      const tariffs = items<{ name: string }>(await client.get("/tariffs"));
      expect(tariffs).toHaveLength(7);
      expect(items(await client.get("/addons"))).toHaveLength(3);
    });
  });

  it("refuses a change that leaves a field out, rather than erasing what the field held", async () => {
    const id = await client.create("/contractors", { name: "Монтажник", note: "Примітка", sortOrder: 5 });
    const serverPlace = await createPlace(client);
    const url = "https://monitoring.example.test";
    const serverId = await client.create("/servers", { programId: serverPlace.programId, name: "Другий", url });

    const contractor = await client.patch(`/contractors/${id}`, { name: "Інший", version: 1 });
    const server = await client.patch(`/servers/${serverId}`, {
      programId: serverPlace.programId,
      name: "Другий",
      version: 1,
    });

    expect(contractor.statusCode).toBe(400);
    expect(server.statusCode).toBe(400);
    expect(items(await client.get("/contractors"))).toMatchObject([
      { name: "Монтажник", note: "Примітка", sortOrder: 5, version: 1 },
    ]);
    expect(items<{ url: string | null }>(await client.get("/servers")).map((row) => row.url)).toContain(url);
  });

  it("opens the lists to whoever reads clients, and changes only to whoever manages them", async () => {
    const id = await client.create("/contractors", { name: "Монтажник" });

    const unread = await withoutPermission(owner, "subscribers.read", () => client.get("/contractors"));
    const unmanaged = await withoutPermission(owner, "references.manage", async () => ({
      list: await client.get("/contractors"),
      create: await client.post("/contractors", { name: "Новий" }),
      change: await client.patch(`/contractors/${id}`, { name: "Інший", note: null, sortOrder: 0, version: 1 }),
      deactivate: await client.post(`/contractors/${id}/deactivate`),
    }));

    expect(unread.statusCode).toBe(403);
    expect(unmanaged.list.statusCode).toBe(200);
    expect(unmanaged.create.statusCode).toBe(403);
    expect(unmanaged.change.statusCode).toBe(403);
    expect(unmanaged.deactivate.statusCode).toBe(403);
    expect(items(await client.get("/contractors"))).toHaveLength(1);
  });

  it("closes the lists to a stranger", async () => {
    expect((await api(client.app, "GET", "/references/programs")).statusCode).toBe(401);
  });
});

async function seedManyRows(client: ReferenceClient): Promise<void> {
  const ROWS = 110;
  const place = await createPlace(client);
  const operatorId = await client.create("/sim-operators", { name: "Оператор" });
  for (let index = 0; index < ROWS; index += 1) {
    const name = `Запис ${index}`;
    await createTariff(client, place, { name });
    await client.create("/servers", { programId: place.programId, name, firstCost: FIRST_COST });
    await client.create("/sim-plans", { operatorId, name, firstCost: FIRST_COST });
    await client.create("/addons", {
      name,
      programIds: [place.programId],
      price: FIRST_COST,
      firstCost: FIRST_COST,
    });
  }
}
