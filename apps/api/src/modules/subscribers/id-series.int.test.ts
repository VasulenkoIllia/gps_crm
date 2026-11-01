import type { IdSeries } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { items, withoutPermission } from "../../test-references.js";
import { clientForm, resetClients, startClientApi, type ClientApi } from "../../test-clients.js";

const PATH = "/subscriber-id-series";

describe("series of ID", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ClientApi;

  const list = async () => items<IdSeries>(await client.call("GET", PATH));
  const named = async (name: string) => {
    const series = (await list()).find((row) => row.name === name);
    if (!series) throw new Error(`no series ${name}`);
    return series;
  };
  const formOf = ({ name, rangeFrom, rangeTo, nextNumber, types, version }: IdSeries, fields: object = {}) => ({
    name,
    rangeFrom,
    rangeTo,
    nextNumber,
    types,
    version,
    ...fields,
  });
  const NEW_SERIES = { name: "Нова", rangeFrom: 100_000, rangeTo: 199_999, nextNumber: 100_000, types: [] };

  beforeAll(async () => {
    client = await startClientApi(db, owner);
  });

  beforeEach(async () => {
    await resetClients(client, owner);
  });

  afterAll(async () => {
    await client.app.close();
    await db.$disconnect();
    await owner.$disconnect();
  });

  it("starts with the two series of D35 and shows what is left in each", async () => {
    await client.createClient();

    expect(await list()).toEqual([
      expect.objectContaining({ name: "Фізособи", types: ["B2C"], nextNumber: 10_001, numbersLeft: 39_999 }),
      expect.objectContaining({ name: "Юрособи", types: ["B2B", "B2G"], nextNumber: 50_000, numbersLeft: 50_000 }),
    ]);
  });

  it("does not change an ID already given", async () => {
    const { id, code } = await client.createClient();
    const series = await named("Фізособи");

    await client.call(
      "PATCH",
      `${PATH}/${series.id}`,
      formOf(series, { rangeFrom: 20_000, rangeTo: 29_999, nextNumber: 20_000 }),
    );

    expect(await client.card(id)).toMatchObject({ code });
    expect((await client.createClient()).code).toBe(20_000);
  });

  it("refuses a range over another series, naming it", async () => {
    const response = await client.call("POST", PATH, { ...NEW_SERIES, rangeFrom: 90_000, nextNumber: 90_000 });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ fieldErrors: { rangeFrom: "Діапазон перетинається із серією «Юрособи»" } });
  });

  it("is refused by the database too, whoever writes the row", async () => {
    await expect(
      owner.subscriberIdSeries.create({
        data: { name: "Обхід", nameNorm: "обхід", rangeFrom: 40_000n, rangeTo: 60_000n, nextNumber: 40_000n },
      }),
    ).rejects.toThrow();
  });

  it("keeps the next number inside the range in the database", async () => {
    await expect(
      owner.subscriberIdSeries.updateMany({ where: { name: "Фізособи" }, data: { nextNumber: 50_001n } }),
    ).rejects.toThrow();
  });

  it("moves a type named in a new series from the one that held it", async () => {
    const response = await client.call("POST", PATH, { ...NEW_SERIES, types: ["B2G"] });

    expect(response.statusCode).toBe(201);
    expect((await named("Юрособи")).types).toEqual(["B2B"]);
    expect((await named("Нова")).types).toEqual(["B2G"]);
  });

  it("takes a form opened before a number was given for a stale one", async () => {
    const before = await named("Фізособи");
    await client.createClient();

    const response = await client.call("PATCH", `${PATH}/${before.id}`, formOf(before));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "version_conflict" });
    expect((await named("Фізособи")).nextNumber).toBe(before.nextNumber + 1);
  });

  it("takes the form of the series a type left for a stale one", async () => {
    const before = await named("Юрособи");
    await client.call("POST", PATH, { ...NEW_SERIES, types: ["B2G"] });

    const response = await client.call("PATCH", `${PATH}/${before.id}`, formOf(before));

    expect(response.statusCode).toBe(409);
    expect((await named("Нова")).types).toEqual(["B2G"]);
  });

  it("does not leave a type without a series", async () => {
    const series = await named("Юрособи");

    const response = await client.call("PATCH", `${PATH}/${series.id}`, formOf(series, { types: ["B2B"] }));

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ fieldErrors: { types: "Тип B2G не має серії" } });
    expect((await named("Юрособи")).types).toEqual(["B2B", "B2G"]);
  });

  it("refuses to save a next number outside the range", async () => {
    const series = await named("Фізособи");

    const response = await client.call("PATCH", `${PATH}/${series.id}`, formOf(series, { nextNumber: 60_000 }));

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      fieldErrors: { nextNumber: "Наступний номер має бути в межах від 10000 до 49999" },
    });
  });

  it("refuses a name in use regardless of case", async () => {
    const response = await client.call("POST", PATH, { ...NEW_SERIES, name: "ЮРОСОБИ" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ fieldErrors: { name: "Така серія вже є" } });
  });

  it("deletes only a series with no types", async () => {
    const created = await client.call("POST", PATH, NEW_SERIES);
    const held = await named("Фізособи");

    const refused = await client.call("DELETE", `${PATH}/${held.id}`);
    const deleted = await client.call("DELETE", `${PATH}/${created.json<{ id: string }>().id}`);

    expect(refused.statusCode).toBe(409);
    expect(deleted.statusCode).toBe(204);
    expect((await list()).map((series) => series.name)).toEqual(["Фізособи", "Юрособи"]);
  });

  it("writes every change to the journal, the types as text", async () => {
    await client.call("POST", PATH, NEW_SERIES);
    const series = await named("Нова");
    await client.call("PATCH", `${PATH}/${series.id}`, formOf(series, { nextNumber: 100_500, types: ["B2G"] }));

    expect((await client.journal("id_series.created"))[0]).toMatchObject({ entityLabel: "Нова" });
    expect((await client.journal("id_series.updated"))[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: "nextNumber", before: 100_000, after: 100_500 },
        { field: "types", before: "", after: "B2G" },
      ]),
    );
  });

  it("wants a version", async () => {
    const series = await named("Фізособи");

    const response = await client.call("PATCH", `${PATH}/${series.id}`, formOf(series, { version: 9 }));

    expect(response.statusCode).toBe(409);
  });

  it("is managed by whoever has the reference lists", async () => {
    const response = await withoutPermission(owner, "references.manage", () => client.call("POST", PATH, NEW_SERIES));

    expect(response.statusCode).toBe(403);
  });

  it("leaves a type with no series unable to create, with a sentence that says where to go", async () => {
    await owner.subscriberIdSeriesType.delete({ where: { type: "B2C" } });

    const response = await client.call("POST", "/subscribers", clientForm(client));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ message: "Тип B2C не має серії. Призначте її на екрані «Серії ID»" });
  });
});
