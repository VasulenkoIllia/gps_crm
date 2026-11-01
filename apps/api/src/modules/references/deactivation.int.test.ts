import type { ArchiveList, Server, SimPlan, SimpleReference, Tariff } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { api } from "../../test-auth.js";
import {
  clearReferences,
  createPlace,
  createTariff,
  items,
  startReferenceClient,
  type PlaceIds,
  type ReferenceClient,
} from "./references.test-support.js";

const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

describe("deactivation and the way back", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ReferenceClient;
  let place: PlaceIds;

  const deactivate = (path: string) => client.post(`${path}/deactivate`);
  const archive = async () =>
    (await api(client.app, "GET", "/archive", { cookie: client.cookie })).json<ArchiveList>().items;
  const restore = (id: string) => api(client.app, "POST", `/archive/${id}/restore`, { cookie: client.cookie });
  const tariffs = async () => items<Tariff>(await client.get("/tariffs"));

  beforeAll(async () => {
    client = await startReferenceClient(db, owner);
  });

  beforeEach(async () => {
    await clearReferences(owner);
    place = await createPlace(client);
  });

  afterAll(async () => {
    await client.app.close();
    await clearReferences(owner);
    await owner.$disconnect();
    await db.$disconnect();
  });

  it("takes a value out of the choice, keeps it in the list and shows a package in the archive", async () => {
    const id = await client.create("/contractors", { name: "Монтажник" });

    const answer = await deactivate(`/contractors/${id}`);

    expect(answer.statusCode, answer.body).toBe(204);
    expect(items<SimpleReference>(await client.get("/contractors?status=active"))).toEqual([]);
    expect(items<SimpleReference>(await client.get("/contractors?status=inactive"))).toMatchObject([
      { id, isActive: false, version: 2 },
    ]);
    expect(items(await client.get("/contractors"))).toHaveLength(1);
    expect(await archive()).toMatchObject([{ entityType: "contractor", label: "Підрядник: Монтажник", itemCount: 1 }]);
  });

  it("brings the value back from the archive, and the journal has the whole way", async () => {
    const id = await client.create("/contractors", { name: "Монтажник" });
    await deactivate(`/contractors/${id}`);
    const [batch] = await archive();

    const answer = await restore(batch?.id ?? "");

    expect(answer.statusCode, answer.body).toBe(204);
    expect(items<SimpleReference>(await client.get("/contractors?status=active"))).toMatchObject([
      { id, isActive: true, version: 3 },
    ]);
    expect(await archive()).toEqual([]);
    expect(await client.journal("record.archived")).toMatchObject([
      {
        entityType: "archive_batch",
        entityId: batch?.id,
        entityLabel: "Підрядник: Монтажник",
        details: [
          { field: "kind", value: "contractor" },
          { field: "itemCount", value: 1 },
        ],
      },
    ]);
    expect(await client.journal("reference.deactivated")).toMatchObject([{ entityId: id, entityLabel: "Монтажник" }]);
    expect(await client.journal("record.restored")).toMatchObject([{ entityId: batch?.id }]);
    expect(await client.journal("reference.restored")).toMatchObject([{ entityId: id, entityLabel: "Монтажник" }]);
  });

  it("does nothing on a second press", async () => {
    const id = await client.create("/contractors", { name: "Монтажник" });
    await deactivate(`/contractors/${id}`);

    const again = await deactivate(`/contractors/${id}`);

    expect(again.statusCode).toBe(204);
    expect(await archive()).toHaveLength(1);
    expect(await client.journal("reference.deactivated")).toHaveLength(1);
  });

  it("gives 404 for a value that is not there", async () => {
    expect((await deactivate(`/tariffs/${UNKNOWN_ID}`)).statusCode).toBe(404);
  });

  it("keeps a deactivated tariff as it was", async () => {
    const id = await createTariff(client, place);
    await deactivate(`/tariffs/${id}`);

    expect(await tariffs()).toMatchObject([{ id, name: "Тариф 1", priceKop: 10_000, isActive: false }]);
    expect(await archive()).toMatchObject([{ entityType: "tariff", label: "Тариф: Тариф 1", itemCount: 1 }]);
  });

  describe("a parent", () => {
    it("takes its servers and tariffs along, as one package", async () => {
      await createTariff(client, place, { name: "Тариф 1" });
      await createTariff(client, place, { name: "Тариф 2" });

      await deactivate(`/programs/${place.programId}`);

      expect(await archive()).toMatchObject([{ entityType: "program", label: "Програма: Програма 1", itemCount: 4 }]);
      expect((await tariffs()).every((tariff) => !tariff.isActive)).toBe(true);
      expect(items<Server>(await client.get("/servers"))).toMatchObject([{ isActive: false }]);
      expect(await client.journal("reference.deactivated")).toHaveLength(4);
      expect(await client.journal("record.archived")).toHaveLength(1);
    });

    it("brings them all back together", async () => {
      await createTariff(client, place);
      await deactivate(`/programs/${place.programId}`);
      const [batch] = await archive();

      expect((await restore(batch?.id ?? "")).statusCode).toBe(204);

      expect(await tariffs()).toMatchObject([{ isActive: true }]);
      expect(items<Server>(await client.get("/servers"))).toMatchObject([{ isActive: true }]);
      expect(await client.journal("reference.restored")).toHaveLength(3);
    });

    it("leaves out what left earlier: it stays in its own package", async () => {
      const left = await createTariff(client, place, { name: "Тариф 1" });
      await createTariff(client, place, { name: "Тариф 2" });
      await deactivate(`/tariffs/${left}`);

      await deactivate(`/servers/${place.serverId}`);

      expect((await archive()).map(({ itemCount }) => itemCount).sort()).toEqual([1, 2]);
    });

    it("takes the plans of an operator along", async () => {
      const operatorId = await client.create("/sim-operators", { name: "Оператор" });
      await client.create("/sim-plans", { operatorId, name: "Трекер 5" });

      await deactivate(`/sim-operators/${operatorId}`);

      expect(items<SimPlan>(await client.get("/sim-plans"))).toMatchObject([{ isActive: false }]);
    });
  });

  describe("what a deactivated parent refuses", () => {
    it("takes no new server, tariff or plan", async () => {
      const tariffId = await createTariff(client, place);
      const operatorId = await client.create("/sim-operators", { name: "Оператор" });
      await deactivate(`/programs/${place.programId}`);
      await deactivate(`/sim-operators/${operatorId}`);

      const server = await client.post("/servers", { programId: place.programId, name: "Сервер 2" });
      const tariff = await client.post("/tariffs", { ...place, name: "Тариф 2", billingModel: "month", priceKop: 1 });
      const version = await client.post(`/tariffs/${tariffId}/new-version`, { name: "Тариф 1 2027", priceKop: 1 });
      const plan = await client.post("/sim-plans", { operatorId, name: "Трекер 5" });

      expect(server.json()).toMatchObject({ fieldErrors: { programId: "Оберіть програму" } });
      expect(tariff.statusCode).toBe(422);
      expect(version.statusCode).toBe(422);
      expect(plan.statusCode).toBe(422);
    });

    it("does not let a package return before its parent, and says which one", async () => {
      const tariffId = await createTariff(client, place);
      await deactivate(`/tariffs/${tariffId}`);
      const [tariffBatch] = await archive();
      await deactivate(`/servers/${place.serverId}`);

      const refused = await restore(tariffBatch?.id ?? "");

      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        code: "restore_blocked",
        message: "Спочатку відновіть запис «Сервер: Сервер 1»",
      });
      expect(await tariffs()).toMatchObject([{ isActive: false }]);
      expect(await archive()).toHaveLength(2);
    });

    it("lets it return once the parent is back", async () => {
      const tariffId = await createTariff(client, place);
      await deactivate(`/tariffs/${tariffId}`);
      const [tariffBatch] = await archive();
      await deactivate(`/servers/${place.serverId}`);
      const serverBatch = (await archive()).find((batch) => batch.id !== tariffBatch?.id);

      expect((await restore(serverBatch?.id ?? "")).statusCode).toBe(204);
      expect((await restore(tariffBatch?.id ?? "")).statusCode).toBe(204);

      expect(await tariffs()).toMatchObject([{ isActive: true }]);
    });
  });
});
