import { currentPrice, firstOfNextMonth, nextPrice, todayKyiv, type Addon, type Server } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { api } from "../../test-auth.js";
import {
  clearReferences,
  createAddon,
  createPlace,
  items,
  startReferenceClient,
  type PlaceIds,
  type ReferenceClient,
} from "../../test-references.js";

const TOO_EARLY = "Нова ціна не може діяти раніше за чинну";
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

describe("prices with a date", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ReferenceClient;
  let place: PlaceIds;

  const addons = async () => items<Addon>(await client.get("/addons"));

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

  describe("addons", () => {
    it("holds a name, its programs and the first price", async () => {
      const id = await createAddon(client, [place.programId]);

      expect(await addons()).toEqual([
        {
          id,
          version: 1,
          name: "Послуга 1",
          isActive: true,
          programs: [{ id: place.programId, name: "Програма 1" }],
          prices: [{ id: expect.any(String) as string, amountKop: 15_000, validFrom: "2026-01-01" }],
          costs: [],
        },
      ]);
    });

    it("takes a program named twice as one program", async () => {
      await client.create("/addons", {
        name: "Послуга 1",
        programIds: [place.programId, place.programId],
        price: { amountKop: 15_000, validFrom: "2026-01-01" },
      });

      expect((await addons())[0]?.programs).toEqual([{ id: place.programId, name: "Програма 1" }]);
    });

    it("needs a program", async () => {
      const refused = await client.post("/addons", {
        name: "Послуга 1",
        programIds: [],
        price: { amountKop: 15_000, validFrom: "2026-01-01" },
      });
      expect(refused.json()).toMatchObject({ fieldErrors: { programIds: "Оберіть програму" } });
    });

    it("refuses a program that is not there", async () => {
      const refused = await client.post("/addons", {
        name: "Послуга 1",
        programIds: [UNKNOWN_ID],
        price: { amountKop: 15_000, validFrom: "2026-01-01" },
      });
      expect(refused.statusCode).toBe(422);
    });

    it("changes the name and the programs, and the journal names them", async () => {
      const id = await createAddon(client, [place.programId]);
      const secondProgram = await client.create("/programs", { name: "Програма 2" });

      const changed = await client.patch(`/addons/${id}`, {
        name: "Послуга 2",
        programIds: [place.programId, secondProgram],
        version: 1,
      });

      expect(changed.statusCode, changed.body).toBe(204);
      expect((await addons())[0]).toMatchObject({ name: "Послуга 2", version: 2 });
      expect((await addons())[0]?.programs).toHaveLength(2);
      expect((await client.journal("reference.updated"))[0]?.changes).toEqual([
        { field: "name", before: "Послуга 1", after: "Послуга 2" },
        { field: "programs", before: "Програма 1", after: "Програма 1, Програма 2" },
      ]);
    });

    it("adds a price from a later date, and until that date the old one stands", async () => {
      const id = await createAddon(client, [place.programId]);
      const today = todayKyiv();
      const planned = firstOfNextMonth(today);

      const added = await client.post(`/addons/${id}/prices`, { amountKop: 18_000, validFrom: planned });
      expect(added.statusCode, added.body).toBe(201);

      const [addon] = await addons();
      expect(currentPrice(addon?.prices ?? [], today)?.amountKop).toBe(15_000);
      expect(nextPrice(addon?.prices ?? [], today)).toMatchObject({ amountKop: 18_000, validFrom: planned });
      expect(currentPrice(addon?.prices ?? [], planned)?.amountKop).toBe(18_000);
      expect((await client.journal("reference.price_added"))[0]).toMatchObject({
        entityId: id,
        entityLabel: "Послуга 1",
        details: [
          { field: "priceKop", value: 18_000 },
          { field: "validFrom", value: planned },
        ],
      });
    });

    it("refuses a price earlier than the last one", async () => {
      const id = await createAddon(client, [place.programId]);

      const refused = await client.post(`/addons/${id}/prices`, { amountKop: 18_000, validFrom: "2025-12-31" });

      expect(refused.statusCode).toBe(422);
      expect(refused.json()).toMatchObject({ code: "price_too_early", fieldErrors: { validFrom: TOO_EARLY } });
      expect((await addons())[0]?.prices).toHaveLength(1);
    });

    it("keeps one price per date", async () => {
      const id = await createAddon(client, [place.programId]);

      const refused = await client.post(`/addons/${id}/prices`, { amountKop: 18_000, validFrom: "2026-01-01" });

      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: "price_date_taken" });
    });

    it("has no way to change a price already written", async () => {
      const id = await createAddon(client, [place.programId]);
      const priceId = (await addons())[0]?.prices[0]?.id ?? "";

      const patch = await api(client.app, "PATCH", `/references/addons/${id}/prices/${priceId}`, {
        cookie: client.cookie,
        payload: { amountKop: 1 },
      });
      const remove = await api(client.app, "DELETE", `/references/addons/${id}/prices/${priceId}`, {
        cookie: client.cookie,
      });

      expect(patch.statusCode).toBe(404);
      expect(remove.statusCode).toBe(404);
    });

    it("gives 404 for an addon that is not there", async () => {
      const answer = await client.post(`/addons/${UNKNOWN_ID}/prices`, { amountKop: 1, validFrom: "2026-01-01" });
      expect(answer.statusCode).toBe(404);
    });

    it.each(["2026-02-30", "01.01.2027", "0000-01-01"])("takes %s for no date", async (validFrom) => {
      const id = await createAddon(client, [place.programId]);

      const refused = await client.post(`/addons/${id}/prices`, { amountKop: 18_000, validFrom });

      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({ fieldErrors: { validFrom: "Вкажіть дату" } });
    });
  });

  describe("costs", () => {
    const cost = (fields: object) => client.post("/cost-prices", fields);

    it("keeps a history for a server, in date order", async () => {
      const subject = { subjectType: "server", subjectId: place.serverId };

      expect((await cost({ ...subject, amountKop: 4_500, validFrom: "2026-01-01" })).statusCode).toBe(201);
      expect((await cost({ ...subject, amountKop: 5_000, validFrom: "2026-06-01" })).statusCode).toBe(201);

      const [server] = items<Server>(await client.get("/servers"));
      expect(server?.costs?.map(({ amountKop }) => amountKop)).toEqual([4_500, 5_000]);
      expect((await client.journal("reference.cost_added"))[0]).toMatchObject({
        entityType: "monitoring_server",
        entityId: place.serverId,
        details: [
          { field: "costKop", value: 5_000 },
          { field: "validFrom", value: "2026-06-01" },
        ],
      });
    });

    it("works the same for a plan of an operator and for an addon", async () => {
      const operatorId = await client.create("/sim-operators", { name: "Оператор" });
      const planId = await client.create("/sim-plans", { operatorId, name: "Трекер 5" });
      const addonId = await createAddon(client, [place.programId]);

      const plan = await cost({
        subjectType: "sim_plan",
        subjectId: planId,
        amountKop: 1_000,
        validFrom: "2026-01-01",
      });
      const addon = await cost({ subjectType: "addon", subjectId: addonId, amountKop: 2_000, validFrom: "2026-01-01" });

      expect(plan.statusCode).toBe(201);
      expect(addon.statusCode).toBe(201);
    });

    it("keeps to the same rule of dates", async () => {
      const subject = { subjectType: "server", subjectId: place.serverId, amountKop: 4_500 };
      await cost({ ...subject, validFrom: "2026-06-01" });

      const early = await cost({ ...subject, validFrom: "2026-05-31" });
      const same = await cost({ ...subject, validFrom: "2026-06-01" });

      expect(early.json()).toMatchObject({ fieldErrors: { validFrom: TOO_EARLY } });
      expect(same.statusCode).toBe(409);
    });

    it("gives 404 for a subject that is not there, and refuses a kind that has no cost", async () => {
      const unknown = await cost({
        subjectType: "server",
        subjectId: UNKNOWN_ID,
        amountKop: 1,
        validFrom: "2026-01-01",
      });
      const wrongKind = await cost({
        subjectType: "tariff",
        subjectId: place.serverId,
        amountKop: 1,
        validFrom: "2026-01-01",
      });

      expect(unknown.statusCode).toBe(404);
      expect(wrongKind.statusCode).toBe(400);
    });
  });
});
