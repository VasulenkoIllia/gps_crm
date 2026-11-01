import type { Contact, SubscriberList, SubscriberListItem } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { items } from "../../test-references.js";
import {
  companyForm,
  clientForm,
  EDRPOU,
  IPN,
  OTHER_EDRPOU,
  resetClients,
  startClientApi,
  updateForm,
  type ClientApi,
} from "../../test-clients.js";
import { reconcileRollups } from "./index.js";

const UNKNOWN_ID = "019a0000-0000-7000-8000-000000000000";
const CONCURRENT_CLIENTS = 50;

describe("clients", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ClientApi;

  const list = async (query = "") => items<SubscriberListItem>(await client.call("GET", `/subscribers?${query}`));
  const names = async (query = "") => (await list(query)).map((row) => row.name);

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

  describe("creation", () => {
    it("makes a client with its ID, tariff, first contact and first payer in one go", async () => {
      const { id, code } = await client.createClient({ legacyCode: " А-77 ", discountKop: 12_050, graceDays: 14 });

      expect(code).toBe(10_000);
      expect(await client.card(id)).toMatchObject({
        code: 10_000,
        legacyCode: "А-77",
        status: "disconnected",
        graceDays: 14,
        discountKop: 12_050,
        tariffId: client.tariffId,
        programName: "Програма 1",
        contractValidUntil: null,
        contractCount: 0,
        isArchived: false,
      });
      const contacts = items<Contact>(await client.call("GET", `/subscribers/${id}/contacts`));
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({
        fullName: "Контактна особа",
        phone: "+380671234567",
        crmUrl: "https://crm.example.test/1",
        isPrimary: true,
        billingNotify: true,
        techNotify: true,
      });
      const payers = (await client.call("GET", `/subscribers/${id}/payers`)).json<{ items: object[] }>().items;
      expect(payers).toEqual([expect.objectContaining({ name: "Клієнт", paymentMethod: "iban" })]);
    });

    it("gives the first payer the name and the tax number of the client", async () => {
      const response = await client.call("POST", "/subscribers", companyForm(client));

      expect(response.statusCode).toBe(201);
      const { id } = response.json<{ id: string }>();
      const payers = (await client.call("GET", `/subscribers/${id}/payers`)).json<{ items: object[] }>().items;
      expect(payers).toEqual([
        expect.objectContaining({ name: "ТОВ Клієнт", taxId: EDRPOU, legalName: "Товариство Клієнт" }),
      ]);
    });

    it("takes the ID from the series of the type", async () => {
      const person = await client.createClient();
      const company = await client.createClient(companyForm(client));
      const state = await client.createClient(companyForm(client, { type: "B2G", taxId: OTHER_EDRPOU }));

      expect([person.code, company.code, state.code]).toEqual([10_000, 50_000, 50_001]);
    });

    it("writes the journal with the ID, the series and the tariff, on the client", async () => {
      const { id } = await client.createClient();

      const [line] = await client.journal("subscriber.created");
      expect(line).toMatchObject({ entityId: id, entityLabel: "Клієнт" });
      expect(line?.details).toEqual(
        expect.arrayContaining([
          { field: "code", value: 10_000 },
          { field: "series", value: "Фізособи" },
        ]),
      );
      const journal = await client.call("GET", `/subscribers/${id}/activity`);
      expect(
        journal
          .json<{ items: { action: string }[] }>()
          .items.map((event) => event.action)
          .sort(),
      ).toEqual(["contact.created", "payer.created", "subscriber.created"]);
    });

    it("marks the tariff as chosen in the same step, and the price stands from then on", async () => {
      await client.createClient();

      const tariff = await owner.tariff.findUniqueOrThrow({ where: { id: client.tariffId } });
      expect(tariff.selectedAt).not.toBeNull();
      expect(tariff.version).toBe(1);
      const change = await client.patch(`/tariffs/${client.tariffId}`, {
        ...client.place,
        name: "Тариф 1",
        billingModel: "month",
        priceKop: 99_999,
        version: 1,
      });
      expect(change.statusCode).toBe(409);
    });

    it("counts the clients on a tariff, leaving out the archive", async () => {
      const first = await client.createClient();
      await client.createClient();
      await client.call("POST", `/subscribers/${first.id}/archive`, {});

      const [tariff] = items<{ clientCount: number }>(await client.get("/tariffs"));
      expect(tariff?.clientCount).toBe(1);
    });

    it("refuses a tariff of another program and rolls everything back", async () => {
      const other = await client.create("/programs", { name: "Інша програма" });

      const response = await client.call("POST", "/subscribers", clientForm(client, { programId: other }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: "tariff_unavailable",
        fieldErrors: { tariffId: "Оберіть тариф програми Інша програма" },
      });
      expect(await owner.subscriber.count()).toBe(0);
      expect((await owner.tariff.findUniqueOrThrow({ where: { id: client.tariffId } })).selectedAt).toBeNull();
    });

    it("refuses a tariff taken out of the choice", async () => {
      await client.post(`/tariffs/${client.tariffId}/deactivate`);

      const response = await client.call("POST", "/subscribers", clientForm(client));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "tariff_unavailable" });
    });

    it("refuses a manager who cannot work", async () => {
      const response = await client.call("POST", "/subscribers", clientForm(client, { managerId: UNKNOWN_ID }));

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ fieldErrors: { managerId: "Оберіть менеджера" } });
    });

    it("refuses a legacy number held by another client, naming that client", async () => {
      await client.createClient({ name: "Перший", legacyCode: "S-1" });

      const response = await client.call("POST", "/subscribers", clientForm(client, { legacyCode: "S-1" }));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "legacy_code_taken",
        fieldErrors: { legacyCode: "Цей старий номер уже має клієнт «Перший»" },
      });
      // The refused one spent nothing
      expect((await owner.subscriberIdSeries.findFirstOrThrow({ where: { name: "Фізособи" } })).nextNumber).toBe(
        10_001n,
      );
    });

    it("refuses a link away from the company's CRM once one is set", async () => {
      const { app, cookie } = client;
      const { buildApp } = await import("../../app.js");
      const { NO_JOBS, NO_MAIL, testConfig } = await import("../../core/test-app.js");
      const { api } = await import("../../test-auth.js");
      const strict = await buildApp({
        db,
        config: testConfig({ crmUrl: "https://crm.company.test" }),
        mailer: NO_MAIL,
        jobs: NO_JOBS,
        checkReady: () => Promise.resolve(),
      });
      const send = (crmUrl: string) =>
        api(strict, "POST", "/subscribers", { cookie, payload: clientForm(client, { crmUrl }) });
      const response = await send("https://crm.example.test/1");
      const disguised = await send("https://crm.company.test@other.example/1");
      const lookalike = await send("https://crm.company.test.other.example/1");
      const fine = await send("https://crm.company.test/clients/1");
      await strict.close();

      expect(app).toBeTruthy();
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        fieldErrors: { crmUrl: "Посилання має вести на https://crm.company.test" },
      });
      expect(disguised.statusCode).toBe(422);
      expect(lookalike.statusCode).toBe(422);
      expect(fine.statusCode).toBe(201);
    });
  });

  describe("numbers of a series", () => {
    it("refuses an ID with a leading zero as a mistake of the form", async () => {
      const { id } = await client.createClient();

      const response = await client.call("PATCH", `/subscribers/${id}/code`, { code: "00123", version: 1 });

      expect(response.statusCode).toBe(400);
    });

    it("gives 50 people at once 50 different numbers in two series, past the numbers set by hand", async () => {
      const taken = await client.createClient({ name: "Зайнятий" });
      const moved = await client.call("PATCH", `/subscribers/${taken.id}/code`, { code: "10010", version: 1 });
      expect(moved.statusCode).toBe(204);

      const results = await Promise.all(
        Array.from({ length: CONCURRENT_CLIENTS }, (_, index) => {
          const isPerson = index % 2 === 0;
          const fields = { name: `Клієнт ${index}` };
          const form = isPerson ? clientForm(client, fields) : companyForm(client, fields);
          return client.call("POST", "/subscribers", form);
        }),
      );

      expect(results.map((result) => result.statusCode)).toEqual(Array(CONCURRENT_CLIENTS).fill(201));
      const codes = results.map((result) => result.json<{ code: number }>().code);
      expect(new Set(codes).size).toBe(CONCURRENT_CLIENTS);
      expect(codes).not.toContain(10_010);
      const persons = codes.filter((code) => code < 50_000);
      const companies = codes.filter((code) => code >= 50_000);
      expect(persons).toHaveLength(25);
      expect(Math.max(...companies)).toBe(50_024);
    });

    it("skips what was taken by hand", async () => {
      const first = await client.createClient();
      await client.call("PATCH", `/subscribers/${first.id}/code`, { code: "10001", version: 1 });

      const second = await client.createClient();

      expect(second.code).toBe(10_002);
    });

    it("gives up after 20 taken numbers in a row, saying so", async () => {
      const series = await owner.subscriberIdSeries.findFirstOrThrow({ where: { name: "Фізособи" } });
      const { id } = await client.createClient();
      const template = await owner.subscriber.findUniqueOrThrow({ where: { id } });
      await owner.subscriber.createMany({
        data: Array.from({ length: 20 }, (_, index) => ({
          ...template,
          id: undefined,
          legacyCode: null,
          code: BigInt(20_000 + index),
        })),
      });
      await owner.subscriberIdSeries.update({ where: { id: series.id }, data: { nextNumber: 20_000n } });

      const response = await client.call("POST", "/subscribers", clientForm(client));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "series_unavailable",
        message: "У серії «Фізособи» 20 номерів підряд зайняті. Змініть наступний номер",
      });
    });

    it("says when a series has run out", async () => {
      await owner.subscriberIdSeries.updateMany({
        where: { name: "Фізособи" },
        data: { rangeTo: 10_000n, nextNumber: 10_001n },
      });

      const response = await client.call("POST", "/subscribers", clientForm(client));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        message: "Серія «Фізособи» вичерпана. Розширте її на екрані «Серії ID»",
      });
    });
  });

  describe("the list", () => {
    it("finds a client by ID, legacy number, tax number, phone, email and name", async () => {
      await client.createClient({ name: "Без збігів" });
      await client.createClient({
        ...companyForm(client, { taxId: EDRPOU }),
        name: "ТОВ Обрій",
        legacyCode: "S-42",
        contact: { fullName: "Особа", phone: "0509876543", channel: "email", email: "Find@Example.test" },
      });

      expect(await names("q=50000")).toEqual(["ТОВ Обрій"]);
      expect(await names("q=S-42")).toEqual(["ТОВ Обрій"]);
      expect(await names(`q=${EDRPOU}`)).toEqual(["ТОВ Обрій"]);
      expect(await names("q=1234")).toEqual(["ТОВ Обрій"]);
      expect(await names("q=6543")).toEqual(["ТОВ Обрій"]);
      expect(await names(`q=${encodeURIComponent("+380 50 987 65 43")}`)).toEqual(["ТОВ Обрій"]);
      expect(await names("q=find@example.test")).toEqual(["ТОВ Обрій"]);
      expect(await names(`q=${encodeURIComponent("обрій")}`)).toEqual(["ТОВ Обрій"]);
      expect(await names(`q=${encodeURIComponent("%")}`)).toEqual([]);
    });

    it("does not search a name by fewer than 3 letters", async () => {
      await client.createClient({ name: "Обрій" });

      expect(await names(`q=${encodeURIComponent("об")}`)).toEqual([]);
    });

    it("filters by type, status, program, tariff and manager", async () => {
      await client.createClient({ name: "Фізособа" });
      await client.createClient(companyForm(client, { name: "Компанія" }));
      const other = await client.create("/programs", { name: "Інша" });
      const server = await client.create("/servers", { programId: other, name: "Сервер" });
      const tariff = await client.create("/tariffs", {
        programId: other,
        serverId: server,
        name: "Т",
        billingModel: "year",
        priceKop: 1,
      });
      await client.createClient({ name: "На іншому", programId: other, tariffId: tariff });
      const adminId = (await client.card((await list())[0]?.id ?? "")).managerId;

      expect(await names("type=B2B")).toEqual(["Компанія"]);
      expect(await names(`programId=${other}`)).toEqual(["На іншому"]);
      expect(await names(`tariffId=${tariff}`)).toEqual(["На іншому"]);
      expect(await names(`status=active`)).toEqual([]);
      expect(await names(`managerId=${UNKNOWN_ID}`)).toEqual([]);
      expect((await names(`managerId=${adminId}`)).length).toBe(3);
    });

    it("shows the archive only when asked", async () => {
      const archived = await client.createClient({ name: "В архіві" });
      await client.createClient({ name: "Діючий" });
      await client.call("POST", `/subscribers/${archived.id}/archive`, {});

      expect(await names()).toEqual(["Діючий"]);
      expect(await names("archived=true")).toEqual(["В архіві"]);
    });

    it.each([
      ["name", "asc", ["Альфа", "Бета", "Гамма", "Дельта", "Епсилон"]],
      ["name", "desc", ["Епсилон", "Дельта", "Гамма", "Бета", "Альфа"]],
      ["code", "asc", ["Гамма", "Альфа", "Епсилон", "Дельта", "Бета"]],
      ["code", "desc", ["Бета", "Дельта", "Епсилон", "Альфа", "Гамма"]],
      ["createdAt", "desc", ["Бета", "Дельта", "Епсилон", "Альфа", "Гамма"]],
      ["objects", "asc", ["Гамма", "Альфа", "Епсилон", "Дельта", "Бета"]],
    ])("walks every page by %s %s without losing a row", async (sort, order, expected) => {
      for (const name of ["Гамма", "Альфа", "Епсилон", "Дельта", "Бета"]) await client.createClient({ name });

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query = `sort=${sort}&order=${order}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
        const response = await client.call("GET", `/subscribers?${query}`);
        expect(response.statusCode).toBe(200);
        const page: SubscriberList = response.json();
        seen.push(...page.items.map((row) => row.name));
        cursor = page.nextCursor;
      } while (cursor);

      expect(seen).toEqual(expected);
    });

    it("counts with the same filters", async () => {
      await client.createClient();
      await client.createClient(companyForm(client));

      const response = await client.call("GET", "/subscribers/count?type=B2B");

      expect(response.json()).toEqual({ count: 1, isCapped: false });
    });
  });

  describe("the card", () => {
    it("answers 404 for a client that is not there", async () => {
      expect((await client.call("GET", `/subscribers/${UNKNOWN_ID}`)).statusCode).toBe(404);
    });

    it("refuses a change with a field left out", async () => {
      const { id } = await client.createClient();
      const incomplete = updateForm(await client.card(id), { note: undefined });

      const response = await client.call("PATCH", `/subscribers/${id}`, incomplete);

      expect(response.statusCode).toBe(400);
    });

    it("writes each changed field to the journal, the manager by name", async () => {
      const { id } = await client.createClient({ graceDays: 7 });
      const before = await client.card(id);
      const other = await owner.user.create({
        data: {
          email: "manager@example.test",
          fullName: "Менеджер Другий",
          status: "active",
          role: { connect: { key: "manager" } },
        },
      });

      const response = await client.call(
        "PATCH",
        `/subscribers/${id}`,
        updateForm(before, { name: "Нова назва", graceDays: 14, discountKop: 500, managerId: other.id }),
      );

      expect(response.statusCode).toBe(204);
      expect(await client.card(id)).toMatchObject({ name: "Нова назва", version: 2, managerName: "Менеджер Другий" });
      const [line] = await client.journal("subscriber.updated");
      expect(line?.changes).toEqual(
        expect.arrayContaining([
          { field: "name", before: "Клієнт", after: "Нова назва" },
          { field: "graceDays", before: 7, after: 14 },
          { field: "discountKop", before: 0, after: 500 },
          { field: "manager", before: before.managerName, after: "Менеджер Другий" },
        ]),
      );
    });

    it("loses the race on an old version with 409", async () => {
      const { id } = await client.createClient();
      const before = await client.card(id);
      await client.call("PATCH", `/subscribers/${id}`, updateForm(before, { name: "Перша зміна" }));

      const response = await client.call("PATCH", `/subscribers/${id}`, updateForm(before, { name: "Друга зміна" }));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "version_conflict" });
    });

    it("keeps the ID when the type changes", async () => {
      const { id, code } = await client.createClient();

      const response = await client.call(
        "PATCH",
        `/subscribers/${id}`,
        updateForm(await client.card(id), { type: "B2B", taxId: IPN }),
      );

      expect(response.statusCode).toBe(204);
      expect(await client.card(id)).toMatchObject({ type: "B2B", code });
    });

    it("answers 409 with the text of the module for a legacy number already taken", async () => {
      await client.createClient({ name: "Перший", legacyCode: "S-1" });
      const { id } = await client.createClient({ name: "Другий" });

      const response = await client.call(
        "PATCH",
        `/subscribers/${id}`,
        updateForm(await client.card(id), { legacyCode: "S-1" }),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        fieldErrors: { legacyCode: "Цей старий номер уже має клієнт «Перший»" },
      });
    });

    it("shows the possible duplicates by each field, without the client itself", async () => {
      const { id } = await client.createClient({
        ...companyForm(client, { name: "Дублікат" }),
        legacyCode: "S-9",
      });
      const query = new URLSearchParams({
        taxId: EDRPOU,
        phone: "067 123 45 67",
        crmUrl: "https://crm.example.test/1",
        legacyCode: "S-9",
      });

      const found = await client.call("GET", `/subscribers/duplicates?${query.toString()}`);
      const quiet = await client.call("GET", `/subscribers/duplicates?${query.toString()}&excludeId=${id}`);

      expect(
        found
          .json<{ items: { field: string }[] }>()
          .items.map((item) => item.field)
          .sort(),
      ).toEqual(["crmUrl", "legacyCode", "phone", "taxId"]);
      expect(found.json<{ items: object[] }>().items[0]).toMatchObject({ id, name: "Дублікат", code: 50_000 });
      expect(quiet.json()).toEqual({ items: [] });
    });

    it("does not stop a second client with the same tax number", async () => {
      await client.createClient(companyForm(client, { name: "Перша" }));

      const response = await client.call("POST", "/subscribers", companyForm(client, { name: "Друга" }));

      expect(response.statusCode).toBe(201);
    });

    it("lists the people who can be managers", async () => {
      const response = await client.call("GET", "/subscribers/managers");

      const { managerId, managerName } = await client.card((await client.createClient()).id);
      expect(response.json<{ items: object[] }>().items).toContainEqual({ id: managerId, fullName: managerName });
    });
  });

  describe("the ID by hand", () => {
    it("changes it with a line in the journal and frees the old one", async () => {
      const { id } = await client.createClient();

      const response = await client.call("PATCH", `/subscribers/${id}/code`, { code: "77777", version: 1 });

      expect(response.statusCode).toBe(204);
      expect(await names("q=77777")).toEqual(["Клієнт"]);
      expect(await names("q=10000")).toEqual([]);
      const [line] = await client.journal("subscriber.code_changed");
      expect(line?.changes).toEqual([{ field: "code", before: 10_000, after: 77_777 }]);
      expect((await client.call("GET", "/subscribers/code-check?code=10000")).json()).toMatchObject({ isFree: true });
    });

    it("refuses a number in use, naming the client", async () => {
      await client.createClient({ name: "Перший" });
      const second = await client.createClient({ name: "Другий" });

      const response = await client.call("PATCH", `/subscribers/${second.id}/code`, { code: "10000", version: 1 });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: "code_taken",
        fieldErrors: { code: "ID уже використовує клієнт «Перший»" },
      });
    });

    it("lets only one of two people have the same number", async () => {
      const first = await client.createClient();
      const second = await client.createClient();

      const results = await Promise.all(
        [first, second].map(({ id }) => client.call("PATCH", `/subscribers/${id}/code`, { code: "70000", version: 1 })),
      );

      expect(results.map((result) => result.statusCode).sort()).toEqual([204, 409]);
    });

    it("checks the number as it is typed", async () => {
      const { id } = await client.createClient({ name: "Власник" });

      const check = async (code: string, extra = "") =>
        (await client.call("GET", `/subscribers/code-check?code=${code}${extra}`)).json<object>();

      expect(await check("123")).toEqual({ isValid: false, isFree: false, holder: null });
      expect(await check("70000")).toEqual({ isValid: true, isFree: true, holder: null });
      expect(await check("10000")).toEqual({ isValid: true, isFree: false, holder: { id, name: "Власник" } });
      expect(await check("10000", `&excludeId=${id}`)).toEqual({ isValid: true, isFree: true, holder: null });
    });

    it("loses to an old version", async () => {
      const { id } = await client.createClient();

      const response = await client.call("PATCH", `/subscribers/${id}/code`, { code: "70000", version: 9 });

      expect(response.statusCode).toBe(409);
    });
  });

  describe("reconciliation", () => {
    it("puts right what drifted, and says how much it looked at", async () => {
      const drifted = await client.createClient();
      await client.createClient();
      await owner.subscriber.update({
        where: { id: drifted.id },
        data: { objectsActive: 3, status: "active" },
      });

      expect(await reconcileRollups(db)).toEqual({ checked: 2, fixed: 1 });
      expect(await client.card(drifted.id)).toMatchObject({ objectsActive: 0, status: "disconnected" });
      expect(await reconcileRollups(db)).toEqual({ checked: 2, fixed: 0 });
    });
  });
});
