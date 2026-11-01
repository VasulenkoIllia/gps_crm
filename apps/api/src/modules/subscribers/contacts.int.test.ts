import type { Contact } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { items } from "../../test-references.js";
import { resetClients, startClientApi, type ClientApi } from "../../test-clients.js";

const CONTACT_FORM = {
  fullName: "Друга особа",
  phone: "0501112233",
  crmUrl: "https://crm.example.test/2",
  channel: "viber",
  viberChatId: "viber-1",
};

describe("contacts", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ClientApi;
  let subscriberId: string;

  const list = async () => items<Contact>(await client.call("GET", `/subscribers/${subscriberId}/contacts`));
  const add = async (fields: object = {}) => {
    const response = await client.call("POST", `/subscribers/${subscriberId}/contacts`, { ...CONTACT_FORM, ...fields });
    expect(response.statusCode).toBe(201);
    return response.json<{ id: string }>().id;
  };
  const updateForm = (contact: Contact, fields: object = {}) => {
    const { fullName, position, phone, phone2, email, telegramChatId, viberChatId, channel, crmUrl } = contact;
    const { isPrimary, billingNotify, techNotify, isActive, note, version } = contact;
    return {
      fullName,
      position,
      phone,
      phone2,
      email,
      telegramChatId,
      viberChatId,
      channel,
      crmUrl,
      isPrimary,
      billingNotify,
      techNotify,
      isActive,
      note,
      version,
      ...fields,
    };
  };
  const primaries = async () => (await list()).filter((row) => row.isPrimary).map((row) => row.fullName);
  const find = async (id: string) => {
    const contact = (await list()).find((row) => row.id === id);
    if (!contact) throw new Error(`no contact ${id}`);
    return contact;
  };

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

  it("adds a contact beside the primary one, keeping the rest of the form", async () => {
    await add({ position: "Бухгалтер", phone2: "0931112233", billingNotify: false });

    expect(await list()).toEqual([
      expect.objectContaining({ fullName: "Контактна особа", isPrimary: true }),
      expect.objectContaining({
        fullName: "Друга особа",
        position: "Бухгалтер",
        phone: "+380501112233",
        phone2: "+380931112233",
        isPrimary: false,
        billingNotify: false,
        techNotify: true,
      }),
    ]);
  });

  it("moves the primary mark, in one step", async () => {
    await add({ isPrimary: true });

    expect(await primaries()).toEqual(["Друга особа"]);
  });

  it("keeps one primary when two people press at once", async () => {
    const first = await add({ fullName: "Перший" });
    const second = await add({ fullName: "Другий" });

    await Promise.all([first, second].map((id) => client.call("POST", `/contacts/${id}/make-primary`, {})));

    expect(await primaries()).toHaveLength(1);
  });

  it("writes the move to the journal with who had it before", async () => {
    const id = await add();

    await client.call("POST", `/contacts/${id}/make-primary`, {});

    const [line] = await client.journal("contact.primary_changed");
    expect(line).toMatchObject({ entityId: id, entityLabel: "Друга особа" });
    expect(line?.details).toEqual(expect.arrayContaining([{ field: "previous", value: "Контактна особа" }]));
  });

  it("writes the move to the journal when a new contact comes in as the primary one", async () => {
    const id = await add({ isPrimary: true });

    expect((await list()).find((contact) => contact.isPrimary)).toMatchObject({ id });
    expect((await client.journal("contact.primary_changed"))[0]).toMatchObject({ entityId: id });
  });

  it("wants the identifier of the channel", async () => {
    const response = await client.call("POST", `/subscribers/${subscriberId}/contacts`, {
      ...CONTACT_FORM,
      channel: "telegram",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      fieldErrors: { telegramChatId: "Для каналу Telegram потрібен Chat ID з CRM" },
    });
  });

  it("wants the whole record on a change, and writes what changed", async () => {
    const id = await add();
    const contact = await find(id);

    const partial = await client.call("PATCH", `/contacts/${id}`, { fullName: "Лише назва", version: 1 });
    const whole = await client.call(
      "PATCH",
      `/contacts/${id}`,
      updateForm(contact, { fullName: "Нове ім'я", isActive: false }),
    );

    expect(partial.statusCode).toBe(400);
    expect(whole.statusCode).toBe(204);
    expect(await find(id)).toMatchObject({ fullName: "Нове ім'я", isActive: false, version: 2 });
    expect((await client.journal("contact.updated"))[0]?.changes).toEqual(
      expect.arrayContaining([
        { field: "fullName", before: "Друга особа", after: "Нове ім'я" },
        { field: "isActive", before: true, after: false },
      ]),
    );
  });

  it("makes a contact primary through its form too", async () => {
    const id = await add();

    await client.call("PATCH", `/contacts/${id}`, updateForm(await find(id), { isPrimary: true }));

    expect(await primaries()).toEqual(["Друга особа"]);
  });

  it("does not take the mark off without a new primary", async () => {
    const [primary] = await list();
    if (!primary) throw new Error("no contact");

    const response = await client.call("PATCH", `/contacts/${primary.id}`, updateForm(primary, { isPrimary: false }));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ fieldErrors: { isPrimary: "Спершу призначте іншого основного контакту" } });
  });

  it("does not archive or delete the primary one", async () => {
    const [primary] = await list();

    const archived = await client.call("POST", `/contacts/${primary?.id}/archive`, {});
    const deleted = await client.call("DELETE", `/contacts/${primary?.id}`);

    expect(archived.statusCode).toBe(409);
    expect(deleted.statusCode).toBe(409);
    expect(archived.json()).toMatchObject({ message: "Спершу призначте іншого основного контакту" });
  });

  it("archives a contact on its own and brings it back", async () => {
    const id = await add();

    expect((await client.call("POST", `/contacts/${id}/archive`, {})).statusCode).toBe(204);
    expect(await find(id)).toMatchObject({ isArchived: true });
    const batches = items<{ entityType: string; label: string }>(await client.call("GET", "/archive"));
    expect(batches[0]).toMatchObject({ entityType: "contact", label: "Контакт: Друга особа" });

    expect((await client.call("POST", `/contacts/${id}/restore`, {})).statusCode).toBe(204);
    expect(await find(id)).toMatchObject({ isArchived: false });
  });

  it("does not change an archived contact", async () => {
    const id = await add();
    await client.call("POST", `/contacts/${id}/archive`, {});

    const response = await client.call("PATCH", `/contacts/${id}`, updateForm(await find(id)));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "record_archived" });
  });

  it("deletes a contact made by mistake, leaving a snapshot in the journal", async () => {
    const id = await add();

    expect((await client.call("DELETE", `/contacts/${id}`)).statusCode).toBe(204);

    expect((await list()).map((row) => row.id)).not.toContain(id);
    const event = await owner.activityEvent.findFirstOrThrow({ where: { action: "contact.deleted" } });
    expect(event.snapshot).toMatchObject({ fullName: "Друга особа", phone: "+380501112233" });
    expect(event.subscriberId).toBe(subscriberId);
  });

  it("does not add a contact to an archived client", async () => {
    await client.call("POST", `/subscribers/${subscriberId}/archive`, {});

    const response = await client.call("POST", `/subscribers/${subscriberId}/contacts`, CONTACT_FORM);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "subscriber_archived" });
  });

  it("refuses a second primary in the database, whoever writes the row", async () => {
    const id = await add();

    await expect(owner.contact.update({ where: { id }, data: { isPrimary: true } })).rejects.toThrow();
  });
});
