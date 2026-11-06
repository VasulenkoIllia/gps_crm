import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ObjectListItem, SubscriberListItem } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  MONTH_AGO,
  NEXT_MONTH,
  resetObjects,
  startObjectApi,
  TODAY,
  YESTERDAY,
  type ObjectApi,
} from "../../test-objects.js";
import { createPlace, createTariff, items } from "../../test-references.js";

const MIGRATION = resolve(
  import.meta.dirname,
  "../../../prisma/migrations/20261106100000_tariff_from_in_lists/migration.sql",
);

// The statements of the migration that fill the day, as they run on a deploy
function backfillStatements(): string[] {
  const text = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  return text
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith("UPDATE"));
}

class RolledBack extends Error {}

// D91: a list marks a tariff that has not begun with the day it does
describe("the day a tariff takes over, in the lists", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ObjectApi;

  const clientRow = async (id: string) => {
    const rows = items<SubscriberListItem>(await client.call("GET", "/subscribers"));
    return rows.find((row) => row.id === id);
  };
  const objectRow = async (id: string) => {
    const rows = items<ObjectListItem>(await client.call("GET", "/objects"));
    return rows.find((row) => row.id === id);
  };
  const changeClientTariff = (programId: string, tariffId: string, validFrom: string) =>
    client.call("POST", `/subscribers/${client.subscriberId}/tariff`, { programId, tariffId, validFrom });

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

  it("gives a client the day of its newest version, and keeps it for a version of the same tariff", async () => {
    // The form of a test client plans the first tariff for the 1st of the next month
    expect(await clientRow(client.subscriberId)).toMatchObject({ tariffFrom: NEXT_MONTH });
    const tariffId = await createTariff(client, client.place, { name: "Тариф 2" });

    await changeClientTariff(client.place.programId, tariffId, TODAY);
    expect(await clientRow(client.subscriberId)).toMatchObject({ tariffName: "Тариф 2", tariffFrom: TODAY });

    await changeClientTariff(client.place.programId, tariffId, NEXT_MONTH);
    expect(await clientRow(client.subscriberId)).toMatchObject({ tariffName: "Тариф 2", tariffFrom: TODAY });
  });

  it("gives an object on the client's tariff the later of its terms and the client's version", async () => {
    const id = await client.createObject();
    expect(await objectRow(id)).toMatchObject({ hasOwnTariff: false, tariffFrom: NEXT_MONTH });
    const tariffId = await createTariff(client, client.place, { name: "Тариф 2" });
    await changeClientTariff(client.place.programId, tariffId, YESTERDAY);
    const payerId = await client.addPayer("Другий");

    await client.call("POST", `/objects/${id}/terms`, { validFrom: NEXT_MONTH, payerId });

    expect(await objectRow(id)).toMatchObject({ tariffName: "Тариф 2", tariffFrom: YESTERDAY });
  });

  it("gives an object its own tariff planned ahead, which a new payer leaves planned", async () => {
    const place = await createPlace(client, "Програма 2", "Сервер 2");
    const tariffId = await createTariff(client, place, { name: "Свій" });
    const id = await client.createObject({
      ownTariff: { programId: place.programId, tariffId, validFrom: NEXT_MONTH },
    });
    expect(await objectRow(id)).toMatchObject({ hasOwnTariff: true, tariffFrom: NEXT_MONTH });
    const payerId = await client.addPayer("Другий");

    await client.call("POST", `/objects/${id}/terms`, { validFrom: YESTERDAY, payerId });
    expect(await objectRow(id)).toMatchObject({ tariffName: "Свій", tariffFrom: NEXT_MONTH });

    // Its own tariff never began, so the object has been on the client's since it was connected
    await client.call("POST", `/objects/${id}/terms`, { validFrom: TODAY, ownTariff: null });
    expect(await objectRow(id)).toMatchObject({ hasOwnTariff: false, tariffFrom: NEXT_MONTH });
    const row = await owner.monitoredObject.findUniqueOrThrow({ where: { id }, select: { tariffFrom: true } });
    expect(row.tariffFrom.toISOString().slice(0, 10)).toBe(MONTH_AGO);
  });

  it("has the migration fill the same day as the app writes", async () => {
    const tariffId = await createTariff(client, client.place, { name: "Тариф 2" });
    await changeClientTariff(client.place.programId, tariffId, YESTERDAY);
    await changeClientTariff(client.place.programId, tariffId, NEXT_MONTH);
    const place = await createPlace(client, "Програма 2", "Сервер 2");
    const ownId = await createTariff(client, place, { name: "Свій" });
    const own = await client.createObject({
      ownTariff: { programId: place.programId, tariffId: ownId, validFrom: TODAY },
    });
    const plain = await client.createObject({ connectedOn: MONTH_AGO });
    await client.call("POST", `/objects/${plain}/terms`, {
      validFrom: NEXT_MONTH,
      payerId: await client.addPayer("Б"),
    });
    await client.call("POST", `/objects/${own}/terms`, { validFrom: NEXT_MONTH, ownTariff: null });
    const days = async (tx: Pick<DbClient, "subscriber" | "monitoredObject">) => ({
      clients: await tx.subscriber.findMany({ orderBy: { id: "asc" }, select: { id: true, tariffFrom: true } }),
      objects: await tx.monitoredObject.findMany({ orderBy: { id: "asc" }, select: { id: true, tariffFrom: true } }),
    });
    const written = await days(owner);

    let filled: typeof written | null = null;
    await owner
      .$transaction(async (tx) => {
        await tx.$executeRaw`ALTER TABLE subscribers ALTER COLUMN tariff_from DROP NOT NULL`;
        await tx.$executeRaw`ALTER TABLE objects ALTER COLUMN tariff_from DROP NOT NULL`;
        await tx.$executeRaw`UPDATE subscribers SET tariff_from = NULL`;
        await tx.$executeRaw`UPDATE objects SET tariff_from = NULL`;
        // The text of our own migration file, nothing from outside
        for (const statement of backfillStatements()) await tx.$executeRaw(Prisma.raw(statement));
        filled = await days(tx);
        throw new RolledBack();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RolledBack)) throw error;
      });

    expect(backfillStatements()).toHaveLength(2);
    expect(filled).toEqual(written);
    expect(written.objects.map((row) => row.tariffFrom.toISOString().slice(0, 10)).sort()).toEqual(
      [NEXT_MONTH, MONTH_AGO].sort(),
    );
  });
});
