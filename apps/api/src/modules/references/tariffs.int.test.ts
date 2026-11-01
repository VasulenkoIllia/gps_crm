import type { Tariff } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import {
  clearReferences,
  createPlace,
  createTariff,
  items,
  startReferenceClient,
  type PlaceIds,
  type ReferenceClient,
} from "./references.test-support.js";

const IN_USE = "Тариф уже використовується. Для нової ціни створіть нову версію тарифу";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

function rowLockIsAwaited(owner: DbClient): Promise<void> {
  return vi.waitFor(async () => {
    const [row] = await owner.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    expect(row?.waiting).toBeGreaterThan(0n);
  });
}

describe("tariffs", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ReferenceClient;
  let place: PlaceIds;

  const list = async () => items<Tariff>(await client.get("/tariffs"));
  const byName = async (name: string) => (await list()).find((tariff) => tariff.name === name);
  const select = (id: string) => owner.tariff.update({ where: { id }, data: { selectedAt: new Date() } });
  const form = (fields: Partial<Tariff> = {}) => ({
    ...place,
    name: "Тариф 1",
    billingModel: "month",
    priceKop: 10_000,
    version: 1,
    ...fields,
  });

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

  it("holds a program, a server, a name, a period and a price", async () => {
    const id = await createTariff(client, place);

    expect(await list()).toEqual([
      {
        id,
        version: 1,
        name: "Тариф 1",
        isActive: true,
        programId: place.programId,
        programName: "Програма 1",
        serverId: place.serverId,
        serverName: "Сервер 1",
        billingModel: "month",
        priceKop: 10_000,
        isSelected: false,
      },
    ]);
  });

  it("takes the same name by the month and by the year", async () => {
    await createTariff(client, place, { billingModel: "month", priceKop: 10_000 });
    await createTariff(client, place, { billingModel: "year", priceKop: 120_000 });

    const again = await client.post("/tariffs", { ...place, name: "ТАРИФ 1", billingModel: "year", priceKop: 1 });

    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({
      code: "name_taken",
      fieldErrors: { name: "Такий тариф на цьому сервері вже є" },
    });
    expect(await list()).toHaveLength(2);
  });

  it("allows the same tariff on another server", async () => {
    const other = await client.create("/servers", { programId: place.programId, name: "Сервер 2" });

    await createTariff(client, place);
    await createTariff(client, { programId: place.programId, serverId: other });

    expect(await list()).toHaveLength(2);
  });

  it("refuses a server of another program, by name", async () => {
    const secondProgram = await client.create("/programs", { name: "Програма 2" });

    const refused = await client.post("/tariffs", {
      programId: secondProgram,
      serverId: place.serverId,
      name: "Тариф 1",
      billingModel: "month",
      priceKop: 10_000,
    });

    expect(refused.statusCode).toBe(422);
    expect(refused.json()).toMatchObject({
      code: "server_not_in_program",
      fieldErrors: { serverId: "Цей сервер не належить програмі Програма 2" },
    });
  });

  it("wants a price above zero", async () => {
    const refused = await client.post("/tariffs", { ...place, name: "Тариф 1", billingModel: "month", priceKop: 0 });

    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ fieldErrors: { priceKop: "Вкажіть ціну більше нуля" } });
  });

  it("lets a price be corrected while nobody has chosen the tariff", async () => {
    const id = await createTariff(client, place);

    const corrected = await client.patch(`/tariffs/${id}`, form({ priceKop: 11_000 }));

    expect(corrected.statusCode, corrected.body).toBe(204);
    expect((await byName("Тариф 1"))?.priceKop).toBe(11_000);
    expect((await client.journal("reference.updated"))[0]?.changes).toEqual([
      { field: "priceKop", before: 10_000, after: 11_000 },
    ]);
  });

  describe("once chosen", () => {
    it.each([
      ["price", { priceKop: 20_000 }, "priceKop"],
      ["period", { billingModel: "year" as const }, "billingModel"],
    ])("does not rewrite its %s", async (_, change, field) => {
      const id = await createTariff(client, place);
      await select(id);

      const refused = await client.patch(`/tariffs/${id}`, form(change));

      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({
        code: "tariff_in_use",
        message: IN_USE,
        fieldErrors: { [field]: IN_USE },
      });
      expect(await byName("Тариф 1")).toMatchObject({ priceKop: 10_000, billingModel: "month", version: 1 });
      expect(await client.journal("reference.updated")).toEqual([]);
    });

    it("does not move to another server", async () => {
      const id = await createTariff(client, place);
      const serverId = await client.create("/servers", { programId: place.programId, name: "Сервер 2" });
      await select(id);

      const refused = await client.patch(`/tariffs/${id}`, form({ serverId }));

      expect(refused.statusCode).toBe(409);
      expect((await byName("Тариф 1"))?.serverName).toBe("Сервер 1");
    });

    it("still lets a mistyped name be corrected", async () => {
      const id = await createTariff(client, place);
      await select(id);

      const renamed = await client.patch(`/tariffs/${id}`, form({ name: "Виправлена назва" }));

      expect(renamed.statusCode, renamed.body).toBe(204);
      expect(await byName("Виправлена назва")).toMatchObject({ priceKop: 10_000, isSelected: true, version: 2 });
    });

    it("loses to a client's form that took the tariff while the change was on its way", async () => {
      const id = await createTariff(client, place);
      const { promise: released, resolve: release } = Promise.withResolvers<void>();
      const { promise: taken, resolve: markTaken } = Promise.withResolvers<void>();
      // The choice is made and not committed: the change reads no choice, then stands in the queue for this row
      const choosing = owner.$transaction(async (tx) => {
        await tx.tariff.update({ where: { id }, data: { selectedAt: new Date() } });
        markTaken();
        await released;
      });
      await taken;

      const change = client.patch(`/tariffs/${id}`, form({ priceKop: 20_000 }));
      await rowLockIsAwaited(owner);
      release();
      await choosing;

      const answer = await change;
      expect(answer.statusCode).toBe(409);
      expect(answer.json()).toMatchObject({ code: "tariff_in_use" });
      expect((await byName("Тариф 1"))?.priceKop).toBe(10_000);
    });
  });

  describe("a new version", () => {
    it("copies the program, the server and the period, and leaves the old tariff as it was", async () => {
      const oldId = await createTariff(client, place, { billingModel: "year", priceKop: 120_000 });
      await select(oldId);

      const id = await client.create(`/tariffs/${oldId}/new-version`, { name: "Тариф 1 2027", priceKop: 200_000 });

      expect(await byName("Тариф 1 2027")).toMatchObject({
        id,
        ...place,
        billingModel: "year",
        priceKop: 200_000,
        isSelected: false,
      });
      expect(await byName("Тариф 1")).toMatchObject({ id: oldId, priceKop: 120_000, isSelected: true, isActive: true });
      expect(await client.journal("reference.tariff_version_created")).toMatchObject([
        {
          entityId: id,
          entityLabel: "Тариф 1 2027",
          details: expect.arrayContaining([{ field: "basedOn", value: "Тариф 1" }]) as unknown,
        },
      ]);
    });

    it("needs a new name", async () => {
      const id = await createTariff(client, place);

      const refused = await client.post(`/tariffs/${id}/new-version`, { name: "тариф 1", priceKop: 20_000 });

      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ fieldErrors: { name: "Такий тариф на цьому сервері вже є" } });
    });

    it("gives 404 for a tariff that is not there", async () => {
      const answer = await client.post(`/tariffs/${UNKNOWN_ID}/new-version`, {
        name: "Тариф 1 2027",
        priceKop: 20_000,
      });
      expect(answer.statusCode).toBe(404);
    });

    it("takes no fields beyond the name and the price", async () => {
      const id = await createTariff(client, place);

      const refused = await client.post(`/tariffs/${id}/new-version`, {
        name: "Тариф 1 2027",
        priceKop: 20_000,
        serverId: place.serverId,
      });

      expect(refused.statusCode).toBe(400);
    });
  });
});
