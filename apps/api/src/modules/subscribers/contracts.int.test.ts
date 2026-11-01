import { rm } from "node:fs/promises";
import { addDays, encodeListCursor, todayKyiv, type Contract, type ContractList } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { testConfig } from "../../core/test-app.js";
import { api } from "../../test-auth.js";
import { items } from "../../test-references.js";
import { resetClients, startClientApi, uploadFile, type ClientApi } from "../../test-clients.js";

const today = todayKyiv();
const PDF = Buffer.from("%PDF-1.7\nтекст договору");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const OVER_LIMIT = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(21 * 1024 * 1024)]);
const FILE_TEXT = "Завантажте PDF або зображення до 20 МБ";

describe("contracts", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ClientApi;
  let subscriberId: string;
  let payerId: string;

  const form = (fields: object = {}) => ({
    payerId,
    number: "12/26",
    signedOn: addDays(today, -100),
    validUntil: addDays(today, 200),
    ...fields,
  });
  const add = async (fields: object = {}, id = subscriberId) => {
    const response = await client.call("POST", `/subscribers/${id}/contracts`, form(fields));
    expect(response.statusCode).toBe(201);
    return response.json<{ id: string }>().id;
  };
  const list = async (query = "") => items<Contract>(await client.call("GET", `/contracts?${query}`));
  const numbers = async (query = "") => (await list(query)).map((row) => row.number);
  const updateForm = (contract: Contract, fields: object = {}) => ({
    payerId: contract.payer.id,
    number: contract.number,
    signedOn: contract.signedOn,
    validUntil: contract.validUntil,
    terminatedOn: contract.terminatedOn,
    note: contract.note,
    version: contract.version,
    ...fields,
  });
  const upload = (id: string, name: string, content: Buffer) => uploadFile(client, id, name, content);
  const readFile = (id: string, query = "") =>
    api(client.app, "GET", `/contracts/${id}/file${query}`, { cookie: client.cookie });

  beforeAll(async () => {
    await rm(testConfig().files.dir, { recursive: true, force: true });
    client = await startClientApi(db, owner);
  });

  beforeEach(async () => {
    await resetClients(client, owner);
    subscriberId = (await client.createClient()).id;
    const payers = items<{ id: string }>(await client.call("GET", `/subscribers/${subscriberId}/payers`));
    payerId = payers[0]?.id ?? "";
  });

  afterAll(async () => {
    await client.app.close();
    await db.$disconnect();
    await owner.$disconnect();
  });

  it("makes a contract and shows when it runs to in the card of the client", async () => {
    await add({ validUntil: addDays(today, 100), number: "1" });
    await add({ validUntil: addDays(today, 200), number: "2" });

    expect(await client.card(subscriberId)).toMatchObject({
      contractValidUntil: addDays(today, 200),
      contractCount: 2,
    });
    expect((await list())[0]).toMatchObject({
      number: "2",
      status: "active",
      isExpiring: false,
      fileName: null,
      subscriber: { id: subscriberId, name: "Клієнт", code: 10_000 },
      payer: { id: payerId, name: "Клієнт" },
    });
  });

  it("refuses the same number with the same payer, ignoring case", async () => {
    await add({ number: "Д-12" });

    const response = await client.call("POST", `/subscribers/${subscriberId}/contracts`, form({ number: "д-12" }));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "contract_number_taken",
      fieldErrors: { number: "У цього платника вже є договір з номером д-12" },
    });
  });

  it("warns about the same number with another payer, and lets it through", async () => {
    await add({ number: "Д-12" });
    const created = await client.call("POST", `/subscribers/${subscriberId}/payers`, {
      name: "Інший",
      paymentMethod: "iban",
      detailsContact: "0671234567",
    });
    const otherPayer = created.json<{ id: string }>().id;

    const check = await client.call(
      "GET",
      `/contracts/number-check?number=${encodeURIComponent("Д-12")}&payerId=${otherPayer}`,
    );
    const again = await client.call(
      "GET",
      `/contracts/number-check?number=${encodeURIComponent("Д-12")}&payerId=${payerId}`,
    );

    expect(check.json()).toMatchObject({ samePayer: null, otherPayer: { payerName: "Клієнт" } });
    expect(again.json()).toMatchObject({ samePayer: { payerName: "Клієнт" } });
    await add({ number: "Д-12", payerId: otherPayer });
    expect(await numbers()).toEqual(["Д-12", "Д-12"]);
  });

  it("gives an archived number back", async () => {
    const id = await add({ number: "Д-1" });

    await client.call("POST", `/contracts/${id}/archive`, {});

    await add({ number: "Д-1" });
  });

  it("wants the end, and not before the signing", async () => {
    const missing = await client.call(
      "POST",
      `/subscribers/${subscriberId}/contracts`,
      form({ validUntil: undefined }),
    );
    const early = await client.call(
      "POST",
      `/subscribers/${subscriberId}/contracts`,
      form({ validUntil: addDays(today, -200) }),
    );

    expect(missing.json()).toMatchObject({ fieldErrors: { validUntil: "Вкажіть, до якої дати діє договір" } });
    expect(early.json()).toMatchObject({ fieldErrors: { validUntil: "Дата закінчення раніше дати підписання" } });
  });

  it("takes a payer of this client only", async () => {
    const other = await client.createClient({ name: "Інший" });
    const payers = items<{ id: string }>(await client.call("GET", `/subscribers/${other.id}/payers`));

    const response = await client.call(
      "POST",
      `/subscribers/${subscriberId}/contracts`,
      form({ payerId: payers[0]?.id }),
    );

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ fieldErrors: { payerId: "Оберіть платника цього клієнта" } });
  });

  it("marks each status and filters by the same rule", async () => {
    await add({ number: "діючий" });
    await add({ number: "спливає", validUntil: addDays(today, 29) });
    await add({ number: "на межі", validUntil: addDays(today, 30) });
    await add({ number: "закінчився", validUntil: addDays(today, -1) });
    await add({ number: "майбутній", signedOn: addDays(today, 1), validUntil: addDays(today, 300) });
    await add({ number: "розірваний", terminatedOn: addDays(today, -1) });

    const statuses = Object.fromEntries((await list()).map((row) => [row.number, row.status]));
    expect(statuses).toEqual({
      діючий: "active",
      спливає: "active",
      "на межі": "active",
      закінчився: "expired",
      майбутній: "pending",
      розірваний: "terminated",
    });
    expect(await numbers("expiring=true")).toEqual(["спливає"]);
    expect((await list("expiring=true"))[0]?.isExpiring).toBe(true);
    expect(await numbers("status=expired")).toEqual(["закінчився"]);
    expect(await numbers("status=pending")).toEqual(["майбутній"]);
    expect(await numbers("status=terminated")).toEqual(["розірваний"]);
    expect((await numbers("status=active")).sort()).toEqual(["діючий", "на межі", "спливає"].sort());
  });

  it("finds a contract by number, client, ID, legacy number, payer and tax number", async () => {
    const company = await client.createClient({
      type: "B2B",
      name: "Обрій",
      taxId: "12345678",
      legacyCode: "S-5",
      payer: { paymentMethod: "invoice", legalName: "Повна назва" },
    });
    const payers = items<{ id: string }>(await client.call("GET", `/subscribers/${company.id}/payers`));
    await add({ number: "ДГ-777", payerId: payers[0]?.id }, company.id);
    await add({ number: "інший" });

    expect(await numbers(`q=${encodeURIComponent("дг-7")}`)).toEqual(["ДГ-777"]);
    expect(await numbers(`q=${encodeURIComponent("обрій")}`)).toEqual(["ДГ-777"]);
    expect(await numbers(`q=${company.code}`)).toEqual(["ДГ-777"]);
    expect(await numbers("q=S-5")).toEqual(["ДГ-777"]);
    expect(await numbers("q=1234")).toEqual(["ДГ-777"]);
    expect(await numbers(`subscriberId=${company.id}`)).toEqual(["ДГ-777"]);
  });

  it("filters by the date of signing", async () => {
    await add({ number: "старий", signedOn: "2026-01-10" });
    await add({ number: "новий", signedOn: addDays(today, -5) });

    expect(await numbers(`signedFrom=${addDays(today, -10)}`)).toEqual(["новий"]);
    expect(await numbers("signedTo=2026-01-31")).toEqual(["старий"]);
  });

  it("walks the pages, newest first, and those running out soonest first", async () => {
    for (const day of [1, 2, 3, 4, 5]) {
      await add({ number: `Д-${day}`, signedOn: addDays(today, -day), validUntil: addDays(today, 30 - day) });
    }

    const walk = async (query: string) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: ContractList = (
          await client.call(
            "GET",
            `/contracts?limit=2&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
          )
        ).json();
        seen.push(...page.items.map((row) => row.number));
        cursor = page.nextCursor;
      } while (cursor);
      return seen;
    };

    expect(await walk("")).toEqual(["Д-1", "Д-2", "Д-3", "Д-4", "Д-5"]);
    expect(await walk("expiring=true")).toEqual(["Д-5", "Д-4", "Д-3", "Д-2", "Д-1"]);
  });

  it("answers 400 for a page cursor without a date, not a failure of the query", async () => {
    const cursor = encodeListCursor({ value: "not-a-date", id: "019a0000-0000-7000-8000-000000000000" });

    const response = await client.call("GET", `/contracts?cursor=${encodeURIComponent(cursor)}`);

    expect(response.statusCode).toBe(400);
  });

  it("changes by the whole record, with the journal", async () => {
    const id = await add({ note: "примітка" });
    const [contract] = await list();
    if (!contract) throw new Error("no contract");

    const partial = await client.call("PATCH", `/contracts/${id}`, { number: "1", version: 1 });
    const whole = await client.call(
      "PATCH",
      `/contracts/${id}`,
      updateForm(contract, { number: "13/26", terminatedOn: today }),
    );
    const old = await client.call("PATCH", `/contracts/${id}`, updateForm(contract));

    expect(partial.statusCode).toBe(400);
    expect(whole.statusCode).toBe(204);
    expect(old.statusCode).toBe(409);
    expect((await list())[0]).toMatchObject({ number: "13/26", status: "terminated" });
    expect((await client.journal("contract.updated"))[0]?.changes).toEqual(
      expect.arrayContaining([{ field: "number", before: "12/26", after: "13/26" }]),
    );
  });

  describe("the file", () => {
    it("keeps a PDF, shows its name in the list, and gives it back through the API only", async () => {
      const id = await add();

      const uploaded = await upload(id, "договір 12.pdf", PDF);

      expect(uploaded.statusCode).toBe(204);
      expect((await list())[0]?.fileName).toBe("договір 12.pdf");
      const download = await readFile(id);
      expect(download.statusCode).toBe(200);
      expect(download.headers["content-type"]).toBe("application/pdf");
      expect(download.headers["content-disposition"]).toBe(
        `attachment; filename="_______ 12.pdf"; filename*=UTF-8''%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D1%96%D1%80%2012.pdf`,
      );
      expect(download.rawPayload.equals(PDF)).toBe(true);
    });

    it("trusts the content and not the name", async () => {
      const id = await add();

      const script = await upload(id, "договір.pdf", Buffer.from("<script>alert(1)</script>"));
      const picture = await upload(id, "скан.pdf", PNG);

      expect(script.statusCode).toBe(422);
      expect(script.json()).toMatchObject({ fieldErrors: { file: FILE_TEXT } });
      expect(picture.statusCode).toBe(204);
      expect((await readFile(id)).headers["content-type"]).toBe("image/png");
    });

    it("refuses a file over 20 MB with the text of the module", async () => {
      const id = await add();

      const response = await upload(id, "великий.pdf", OVER_LIMIT);

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ fieldErrors: { file: FILE_TEXT } });
      expect(await owner.storedFile.count()).toBe(0);
    });

    it("takes a file over the 1 MB limit of a plain request", async () => {
      const id = await add();

      const response = await upload(id, "скан.pdf", Buffer.concat([PDF, Buffer.alloc(2 * 1024 * 1024)]));

      expect(response.statusCode).toBe(204);
    });

    it("refuses a request that is no file at all", async () => {
      const id = await add();

      const response = await client.call("POST", `/contracts/${id}/file`, {});

      expect(response.statusCode).toBe(422);
    });

    it("writes each upload, view and download to the journal, on the client", async () => {
      const id = await add();
      await upload(id, "файл.pdf", PDF);

      await readFile(id, "?disposition=inline");
      await readFile(id);

      for (const action of ["contract.file_uploaded", "contract.file_viewed", "contract.file_downloaded"]) {
        const [line] = await client.journal(action);
        expect(line).toMatchObject({ entityId: id });
        expect(line?.details).toEqual(expect.arrayContaining([{ field: "fileName", value: "файл.pdf" }]));
      }
      const inline = await readFile(id, "?disposition=inline");
      expect(inline.headers["content-disposition"]).toContain("inline;");
      expect(inline.headers["cache-control"]).toBe("private, no-store");
      expect(inline.headers["x-content-type-options"]).toBe("nosniff");
      const activity = await client.call("GET", `/subscribers/${subscriberId}/activity?action=contract.file_viewed`);
      expect(activity.json<{ items: object[] }>().items).not.toHaveLength(0);
    });

    it("shows the newest file and keeps the old one", async () => {
      const id = await add();
      await upload(id, "перший.pdf", PDF);

      await upload(id, "другий.png", PNG);

      expect((await list())[0]?.fileName).toBe("другий.png");
      expect(await owner.storedFile.count({ where: { ownerId: id } })).toBe(2);
    });

    it("answers 404 when there is no file", async () => {
      expect((await readFile(await add())).statusCode).toBe(404);
    });

    it("says so when the row is there and the file is not, instead of failing", async () => {
      const id = await add();
      await upload(id, "файл.pdf", PDF);
      await rm(testConfig().files.dir, { recursive: true, force: true });

      const response = await readFile(id);

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: "file_missing" });
    });

    it("leaves no way in without a session", async () => {
      const id = await add();
      await upload(id, "файл.pdf", PDF);

      const response = await api(client.app, "GET", `/contracts/${id}/file`, {});

      expect(response.statusCode).toBe(401);
    });

    it("does not take a file for an archived contract", async () => {
      const id = await add();
      await client.call("POST", `/contracts/${id}/archive`, {});

      const response = await upload(id, "файл.pdf", PDF);

      expect(response.statusCode).toBe(409);
      expect(await owner.storedFile.count()).toBe(0);
    });
  });

  it("archives a contract, keeps its file, and brings both back", async () => {
    const id = await add();
    await upload(id, "файл.pdf", PDF);

    await client.call("POST", `/contracts/${id}/archive`, {});
    expect(await numbers()).toEqual([]);
    expect((await client.card(subscriberId)).contractValidUntil).toBeNull();

    await client.call("POST", `/contracts/${id}/restore`, {});
    expect((await list())[0]?.fileName).toBe("файл.pdf");
  });

  it("does not bring a contract back to a number taken in the meantime", async () => {
    const id = await add({ number: "Д-1" });
    await client.call("POST", `/contracts/${id}/archive`, {});
    await add({ number: "Д-1" });

    const response = await client.call("POST", `/contracts/${id}/restore`, {});

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "restore_blocked",
      message: "Номер договору Д-1 у цього платника вже зайнято",
    });
  });
});
