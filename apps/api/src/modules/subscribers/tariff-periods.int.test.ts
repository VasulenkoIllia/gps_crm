import { addDays, firstOfNextMonth, todayKyiv } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { createTariff } from "../../test-references.js";
import { resetClients, startClientApi, type ClientApi } from "./subscribers.test-support.js";

const today = todayKyiv();
const NEXT_FIRST = firstOfNextMonth(today);
const LAST_WEEK = addDays(today, -7);
const LAST_MONTH = addDays(today, -30);

describe("the tariff of a client", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ClientApi;
  let otherTariff: string;

  const change = (id: string, validFrom: string, tariffId = otherTariff) =>
    client.call("POST", `/subscribers/${id}/tariff`, { programId: client.place.programId, tariffId, validFrom });
  const periods = async (id: string) => (await client.card(id)).tariffHistory;

  beforeAll(async () => {
    client = await startClientApi(db, owner);
  });

  beforeEach(async () => {
    await resetClients(client, owner);
    otherTariff = await createTariff(client, client.place, { name: "Тариф 2" });
  });

  afterAll(async () => {
    await client.app.close();
    await db.$disconnect();
    await owner.$disconnect();
  });

  it("opens a new version and closes the one before it on the same day", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_MONTH });

    const response = await change(id, LAST_WEEK);

    expect(response.statusCode).toBe(204);
    expect(await periods(id)).toEqual([
      expect.objectContaining({ tariffId: otherTariff, validFrom: LAST_WEEK, validTo: null, tariffName: "Тариф 2" }),
      expect.objectContaining({ tariffId: client.tariffId, validFrom: LAST_MONTH, validTo: LAST_WEEK }),
    ]);
    expect(await client.card(id)).toMatchObject({ tariffId: otherTariff });
  });

  it("does not take the version of the client: a form left open stays valid", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_MONTH });

    await change(id, today);

    expect(await client.card(id)).toMatchObject({ version: 1 });
  });

  it("takes the first of the next month and refuses any other day ahead", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_MONTH });

    expect((await change(id, NEXT_FIRST)).statusCode).toBe(204);
    const refused = await change(id, addDays(NEXT_FIRST, 1));

    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({
      fieldErrors: { validFrom: "Оберіть минулу дату, сьогодні або 1-ше число наступного місяця" },
    });
  });

  it("fixes a mistake with a new version of the same date", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_MONTH });
    await change(id, LAST_WEEK);

    const response = await change(id, LAST_WEEK, client.tariffId);

    expect(response.statusCode).toBe(204);
    const history = await periods(id);
    expect(history.map((period) => [period.tariffId, period.validFrom, period.validTo])).toEqual([
      [client.tariffId, LAST_WEEK, null],
      [client.tariffId, LAST_MONTH, LAST_WEEK],
    ]);
  });

  it("drops a version that has not begun in favour of a date before it", async () => {
    const { id } = await client.createClient({ tariffValidFrom: NEXT_FIRST });
    const third = await createTariff(client, client.place, { name: "Тариф 3" });

    expect((await change(id, LAST_WEEK, third)).statusCode).toBe(204);

    expect((await periods(id)).map((period) => period.tariffId)).toEqual([third]);
    expect(await client.card(id)).toMatchObject({ tariffId: third });
  });

  it("refuses a date behind a version that has begun: a past version is not edited", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_WEEK });

    const response = await change(id, LAST_MONTH);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "tariff_date_overlap" });
    expect(await periods(id)).toHaveLength(1);
  });

  it("leaves no two versions over one day, whatever the database is asked", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_MONTH });

    await expect(
      owner.subscriberTariffPeriod.create({
        data: { subscriberId: id, tariffId: otherTariff, validFrom: new Date(`${LAST_WEEK}T00:00:00Z`) },
      }),
    ).rejects.toThrow();
  });

  it("writes the change with its date to the journal", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_MONTH });

    await change(id, LAST_WEEK);

    const [line] = await client.journal("subscriber.tariff_changed");
    expect(line?.changes).toEqual([{ field: "tariff", before: "Тариф 1", after: "Тариф 2 (Сервер 1)" }]);
    expect(line?.details).toEqual(expect.arrayContaining([{ field: "validFrom", value: LAST_WEEK }]));
  });

  it("moves the mark of a chosen tariff to the new one", async () => {
    const { id } = await client.createClient({ tariffValidFrom: LAST_MONTH });
    expect((await owner.tariff.findUniqueOrThrow({ where: { id: otherTariff } })).selectedAt).toBeNull();

    await change(id, today);

    expect((await owner.tariff.findUniqueOrThrow({ where: { id: otherTariff } })).selectedAt).not.toBeNull();
  });

  it("does not let a second transaction change the price of a tariff taken a moment ago", async () => {
    const results = await Promise.all([
      client.createClient(),
      client.patch(`/tariffs/${client.tariffId}`, {
        ...client.place,
        name: "Тариф 1",
        billingModel: "month",
        priceKop: 55_555,
        version: 1,
      }),
    ]);

    const { priceKop } = await owner.tariff.findUniqueOrThrow({ where: { id: client.tariffId } });
    const isPriceChanged = results[1].statusCode === 204;
    expect(Number(priceKop)).toBe(isPriceChanged ? 55_555 : 10_000);
    expect(await owner.subscriber.count()).toBe(1);
  });
});
