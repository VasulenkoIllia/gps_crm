import type { Payer } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { items } from "../../test-references.js";
import { companyForm, EDRPOU, OTHER_EDRPOU, resetClients, startClientApi, type ClientApi } from "../../test-clients.js";

const INVOICE = { name: "Платник", paymentMethod: "invoice", legalName: "Повна назва", taxId: OTHER_EDRPOU };
const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";

const LAST_ID = "ffffffff-ffff-7fff-bfff-ffffffffffff";

describe("payers", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ClientApi;
  let subscriberId: string;

  const list = async (id = subscriberId) => items<Payer>(await client.call("GET", `/subscribers/${id}/payers`));
  const add = async (fields: object = {}, id = subscriberId) => {
    const response = await client.call("POST", `/subscribers/${id}/payers`, { ...INVOICE, ...fields });
    expect(response.statusCode).toBe(201);
    return response.json<{ id: string }>().id;
  };
  const link = (payerId: string, id: string) => client.call("POST", `/subscribers/${id}/payers/${payerId}/link`, {});
  const unlink = (payerId: string, id: string) => client.call("DELETE", `/subscribers/${id}/payers/${payerId}/link`);

  beforeAll(async () => {
    client = await startClientApi(db, owner);
  });

  beforeEach(async () => {
    await resetClients(client, owner);
    subscriberId = (await client.createClient()).id;
  });

  afterAll(async () => {
    await client.app.close();
    await db.$disconnect();
    await owner.$disconnect();
  });

  it("finds nothing by too short a name, also from the middle of a list", async () => {
    const from = await client.call("GET", `/payers?q=ab&cursor=${LAST_ID}`);

    expect(from.statusCode).toBe(200);
    expect(items<Payer>(from)).toEqual([]);
  });

  it("adds a payer with a form of payment and its fields", async () => {
    await add({ paymentTermsNote: "не пізніше 10-го числа" });

    expect((await list()).map((payer) => payer.name)).toEqual(["Клієнт", "Платник"]);
    expect((await list())[1]).toMatchObject({
      paymentMethod: "invoice",
      legalName: "Повна назва",
      taxId: OTHER_EDRPOU,
      paymentTermsNote: "не пізніше 10-го числа",
    });
  });

  it.each([
    ["invoice", {}, { legalName: "Вкажіть повну назву юрособи для рахунку", taxId: "Вкажіть ЄДРПОУ або ІПН" }],
    ["vchasno", { legalName: "Назва", taxId: EDRPOU }, { vchasnoEmail: "Вкажіть пошту для відправки у «Вчасно»" }],
    ["iban", {}, { detailsContact: "Вкажіть телефон або пошту, куди надсилати реквізити" }],
  ])("asks %s for its fields", async (paymentMethod, fields, errors) => {
    const response = await client.call("POST", `/subscribers/${subscriberId}/payers`, {
      name: "Платник",
      paymentMethod,
      ...fields,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ fieldErrors: errors });
  });

  it("refuses a method without its fields in the database, whoever writes the row", async () => {
    await expect(
      owner.payer.create({ data: { name: "Обхід", nameNorm: "обхід", paymentMethod: "vchasno" } }),
    ).rejects.toThrow();
  });

  it("pays for two clients as one record", async () => {
    const payerId = await add();
    const other = await client.createClient({ name: "Другий клієнт" });

    const response = await link(payerId, other.id);

    expect(response.statusCode).toBe(204);
    expect(await list(other.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: payerId,
          otherClients: [expect.objectContaining({ id: subscriberId, name: "Клієнт" })],
        }),
      ]),
    );
    expect((await client.journal("payer.linked"))[0]).toMatchObject({ entityId: payerId });
  });

  it("links once: a second press changes nothing", async () => {
    const payerId = await add();
    const other = await client.createClient();

    await link(payerId, other.id);
    await link(payerId, other.id);

    expect(await client.journal("payer.linked")).toHaveLength(1);
  });

  it("finds a payer by tax number and by name, for the hint about a match", async () => {
    await add();

    const byNumber = await client.call("GET", `/payers?q=${OTHER_EDRPOU}`);
    const byName = await client.call("GET", `/payers?q=${encodeURIComponent("платник")}`);
    const nothing = await client.call("GET", `/payers?q=${UNKNOWN_ID.slice(0, 8)}`);

    expect(items<Payer>(byNumber).map((payer) => payer.name)).toEqual(["Платник"]);
    expect(items<Payer>(byName).map((payer) => payer.name)).toEqual(["Платник"]);
    expect(items<Payer>(nothing)).toEqual([]);
  });

  it("looks for a name from three letters, and takes a percent sign for a percent sign", async () => {
    await add({ name: "Платник 50%" });
    await add({ name: "Платник 500" });
    const found = async (text: string) =>
      items<Payer>(await client.call("GET", `/payers?q=${encodeURIComponent(text)}`)).map((payer) => payer.name);

    expect(await found("пл")).toEqual([]);
    expect(await found("50%")).toEqual(["Платник 50%"]);
    expect(await found("%%%")).toEqual([]);
  });

  it("does not block a second payer with the same tax number", async () => {
    await add();

    await add({ name: "Двійник" });

    expect(items<Payer>(await client.call("GET", `/payers?q=${OTHER_EDRPOU}`))).toHaveLength(2);
  });

  it("does not link an archived payer", async () => {
    const payerId = await add();
    const other = await client.createClient();
    await client.call("POST", `/payers/${payerId}/archive`, {});

    const response = await link(payerId, other.id);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "record_archived" });
  });

  it("unlinks a payer with nothing on it, and refuses one with a contract of this client", async () => {
    const payerId = await add();
    await client.call("POST", `/subscribers/${subscriberId}/contracts`, {
      payerId,
      number: "1",
      signedOn: "2026-01-01",
      validUntil: "2026-12-31",
    });
    const free = await add({ name: "Вільний" });

    const refused = await unlink(payerId, subscriberId);
    const fine = await unlink(free, subscriberId);

    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "payer_in_use" });
    expect(fine.statusCode).toBe(204);
    expect((await list()).map((payer) => payer.id)).not.toContain(free);
    expect((await client.journal("payer.unlinked"))[0]).toMatchObject({ entityId: free });
  });

  it("does not unlink a payer whose contract waits in the archive: it could not come back", async () => {
    const payerId = await add();
    const contract = await client.call("POST", `/subscribers/${subscriberId}/contracts`, {
      payerId,
      number: "1",
      signedOn: "2026-01-01",
      validUntil: "2026-12-31",
    });
    await client.call("POST", `/contracts/${contract.json<{ id: string }>().id}/archive`, {});

    const response = await unlink(payerId, subscriberId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "payer_in_use" });
  });

  it("is refused a contract of a client it does not pay for by the database too", async () => {
    const payerId = await add();
    const other = await client.createClient({ name: "Другий" });

    await expect(
      owner.contract.create({
        data: {
          subscriberId: other.id,
          payerId,
          number: "1",
          numberNorm: "1",
          signedOn: new Date("2026-01-01"),
          validUntil: new Date("2026-12-31"),
        },
      }),
    ).rejects.toThrow();
  });

  it("changes requisites by the whole record, with the journal", async () => {
    const payerId = await add();
    const [, payer] = await list();
    if (!payer) throw new Error("no payer");
    const { name, paymentMethod, legalName, taxId, vchasnoEmail, detailsContact, paymentTermsNote, note } = payer;
    const form = { name, paymentMethod, legalName, taxId, vchasnoEmail, detailsContact, paymentTermsNote, note };

    const partial = await client.call("PATCH", `/payers/${payerId}`, { name: "Лише назва", version: 1 });
    const whole = await client.call("PATCH", `/payers/${payerId}`, {
      ...form,
      paymentMethod: "vchasno",
      vchasnoEmail: "VCHASNO@example.test",
      version: 1,
    });
    const old = await client.call("PATCH", `/payers/${payerId}`, { ...form, version: 1 });

    expect(partial.statusCode).toBe(400);
    expect(whole.statusCode).toBe(204);
    expect(old.statusCode).toBe(409);
    expect((await list())[1]).toMatchObject({ paymentMethod: "vchasno", vchasnoEmail: "vchasno@example.test" });
    expect((await client.journal("payer.updated"))[0]?.changes).toEqual(
      expect.arrayContaining([{ field: "paymentMethod", before: "invoice", after: "vchasno" }]),
    );
  });

  it("archives a payer and brings it back", async () => {
    const payerId = await add();

    await client.call("POST", `/payers/${payerId}/archive`, {});
    expect((await list()).find((payer) => payer.id === payerId)).toMatchObject({ isArchived: true });
    expect(items<Payer>(await client.call("GET", `/payers?q=${OTHER_EDRPOU}`))).toEqual([]);

    await client.call("POST", `/payers/${payerId}/restore`, {});
    expect((await list()).find((payer) => payer.id === payerId)).toMatchObject({ isArchived: false });
  });

  it("shows the contract numbers of this client, and not those of another", async () => {
    const payerId = await add();
    const other = await client.createClient(companyForm(client, { name: "Другий" }));
    await link(payerId, other.id);
    const contract = (number: string) => ({ payerId, number, signedOn: "2026-01-01", validUntil: "2026-12-31" });
    await client.call("POST", `/subscribers/${subscriberId}/contracts`, contract("Д-1"));
    await client.call("POST", `/subscribers/${other.id}/contracts`, contract("Д-2"));

    expect((await list()).find((payer) => payer.id === payerId)?.contractNumbers).toEqual(["Д-1"]);
  });

  it("answers 404 for a client or a payer that is not there", async () => {
    expect((await client.call("GET", `/subscribers/${UNKNOWN_ID}/payers`)).statusCode).toBe(404);
    expect((await link(UNKNOWN_ID, subscriberId)).statusCode).toBe(404);
  });
});
