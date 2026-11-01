import type { Payer, SubscriberListItem } from "@gps_crm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "../../core/db/client.js";
import { connectTestAppDatabase, connectTestDatabase } from "../../core/db/test-database.js";
import { items } from "../../test-references.js";
import { resetClients, startClientApi, updateForm, uploadFile, type ClientApi } from "../../test-clients.js";

const CONTRACT = { number: "1", signedOn: "2026-01-01", validUntil: "2026-12-31" };
const SECOND_CONTACT = {
  fullName: "Другий",
  phone: "0501112233",
  crmUrl: "https://crm.example.test/2",
  channel: "viber",
  viberChatId: "v-1",
};

function requestsWaitForLocks(owner: DbClient, count: number): Promise<void> {
  return vi.waitFor(async () => {
    const [row] = await owner.$queryRaw<{ waiting: bigint }[]>`
      SELECT count(*) AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `;
    expect(row?.waiting).toBe(BigInt(count));
  });
}

// Keeps a client's row locked until the returned function runs
async function holdClient(owner: DbClient, id: string): Promise<() => Promise<void>> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markHeld = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  const holder = owner.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM subscribers WHERE id = ${id}::uuid FOR UPDATE`;
    markHeld();
    await released;
  });
  await held;
  return () => {
    release();
    return holder;
  };
}

describe("the archive of a client", () => {
  const owner: DbClient = connectTestDatabase();
  const db: DbClient = connectTestAppDatabase();
  let client: ClientApi;

  const payersOf = async (id: string) =>
    items<{ id: string; isArchived: boolean }>(await client.call("GET", `/subscribers/${id}/payers`));
  const batches = async () =>
    items<{ id: string; entityType: string; label: string; itemCount: number }>(await client.call("GET", "/archive"));
  const archived = async (id: string) => (await client.card(id)).isArchived;

  async function clientWithRecords(fields: object = {}): Promise<{ id: string; payerId: string }> {
    const { id } = await client.createClient(fields);
    await client.call("POST", `/subscribers/${id}/contacts`, SECOND_CONTACT);
    const [payer] = await payersOf(id);
    await client.call("POST", `/subscribers/${id}/contracts`, { ...CONTRACT, payerId: payer?.id });
    return { id, payerId: payer?.id ?? "" };
  }

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

  it("takes the contacts, the contracts and its own payer along, as one package", async () => {
    const { id } = await clientWithRecords();

    expect((await client.call("POST", `/subscribers/${id}/archive`, {})).statusCode).toBe(204);

    expect(await archived(id)).toBe(true);
    expect((await batches())[0]).toMatchObject({ entityType: "subscriber", label: "Клієнт: Клієнт", itemCount: 5 });
    expect(await owner.contact.count({ where: { archivedAt: null } })).toBe(0);
    expect(await owner.contract.count({ where: { archivedAt: null } })).toBe(0);
    expect(await owner.payer.count({ where: { archivedAt: null } })).toBe(0);
    const ids = await owner.contact.findMany({ select: { archiveBatchId: true } });
    expect(new Set(ids.map((row) => row.archiveBatchId)).size).toBe(1);
  });

  it("brings the whole package back through the card", async () => {
    const { id } = await clientWithRecords();
    await client.call("POST", `/subscribers/${id}/archive`, {});

    expect((await client.call("POST", `/subscribers/${id}/restore`, {})).statusCode).toBe(204);

    expect(await archived(id)).toBe(false);
    expect(await owner.contact.count({ where: { archivedAt: null } })).toBe(2);
    expect(await owner.contract.count({ where: { archivedAt: null } })).toBe(1);
    expect(await owner.payer.count({ where: { archivedAt: null } })).toBe(1);
    expect(await batches()).toEqual([]);
  });

  it("brings it back through the archive screen too", async () => {
    const { id } = await clientWithRecords();
    await client.call("POST", `/subscribers/${id}/archive`, {});
    const [batch] = await batches();

    expect((await client.call("POST", `/archive/${batch?.id}/restore`, {})).statusCode).toBe(204);

    expect(await archived(id)).toBe(false);
    for (const action of ["subscriber.restored", "contact.restored", "contract.restored", "payer.restored"]) {
      expect((await client.journal(action)).length).toBeGreaterThan(0);
    }
  });

  it("leaves a payer who still pays for someone else", async () => {
    const { id, payerId } = await clientWithRecords();
    const other = await client.createClient({ name: "Другий" });
    await client.call("POST", `/subscribers/${other.id}/payers/${payerId}/link`, {});

    await client.call("POST", `/subscribers/${id}/archive`, {});

    expect((await owner.payer.findUniqueOrThrow({ where: { id: payerId } })).archivedAt).toBeNull();
  });

  it("archives a payer whose other clients are in the archive already", async () => {
    const { id, payerId } = await clientWithRecords();
    const other = await client.createClient({ name: "Другий" });
    await client.call("POST", `/subscribers/${other.id}/payers/${payerId}/link`, {});
    await client.call("POST", `/subscribers/${other.id}/archive`, {});

    await client.call("POST", `/subscribers/${id}/archive`, {});

    expect((await owner.payer.findUniqueOrThrow({ where: { id: payerId } })).archivedAt).not.toBeNull();
  });

  it("takes a payer of two clients along with the second of them, when both go at once", async () => {
    const first = await client.createClient();
    const [payer] = await payersOf(first.id);
    const second = await client.createClient({ name: "Другий" });
    await client.call("POST", `/subscribers/${second.id}/payers/${payer?.id}/link`, {});

    await Promise.all([first, second].map(({ id }) => client.call("POST", `/subscribers/${id}/archive`, {})));

    const row = await owner.payer.findUniqueOrThrow({ where: { id: payer?.id ?? "" } });
    expect(row.archivedAt).not.toBeNull();
  });

  it("refuses while objects are active, saying how many", async () => {
    const { id } = await client.createClient();
    await owner.subscriber.update({ where: { id }, data: { objectsActive: 2, objectsSuspended: 1 } });

    const response = await client.call("POST", `/subscribers/${id}/archive`, {});

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "subscriber_has_objects",
      message: "Спершу відключіть об'єкти клієнта: активних 2, призупинених 1",
    });
  });

  it("is safe to press twice", async () => {
    const { id } = await client.createClient();

    await client.call("POST", `/subscribers/${id}/archive`, {});
    const second = await client.call("POST", `/subscribers/${id}/archive`, {});
    const restored = await client.call("POST", `/subscribers/${id}/restore`, {});
    const again = await client.call("POST", `/subscribers/${id}/restore`, {});

    expect(second.statusCode).toBe(204);
    expect(restored.statusCode).toBe(204);
    expect(again.statusCode).toBe(204);
    expect(await batches()).toEqual([]);
  });

  it("keeps the ID in the archive, so nobody else can take it", async () => {
    const { id, code } = await client.createClient();
    await client.call("POST", `/subscribers/${id}/archive`, {});

    const second = await client.createClient();
    const taken = await client.call("PATCH", `/subscribers/${second.id}/code`, { code: String(code), version: 1 });

    expect(taken.statusCode).toBe(409);
    expect((await client.card(id)).code).toBe(code);
  });

  it("does not change a client in the archive", async () => {
    const { id } = await client.createClient();
    await client.call("POST", `/subscribers/${id}/archive`, {});

    const response = await client.call("PATCH", `/subscribers/${id}`, updateForm(await client.card(id)));

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "subscriber_archived" });
  });

  it("does not bring back a contact whose client went to the archive after it", async () => {
    const { id } = await clientWithRecords();
    const contacts = items<{ id: string; isPrimary: boolean }>(await client.call("GET", `/subscribers/${id}/contacts`));
    const second = contacts.find((contact) => !contact.isPrimary);
    await client.call("POST", `/contacts/${second?.id}/archive`, {});
    await client.call("POST", `/subscribers/${id}/archive`, {});

    const response = await client.call("POST", `/contacts/${second?.id}/restore`, {});

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "restore_blocked", message: "Спершу відновіть клієнта «Клієнт»" });
  });

  it("does not bring back a contract whose payer is in the archive on its own", async () => {
    const { id, payerId } = await clientWithRecords();
    const contracts = items<{ id: string }>(await client.call("GET", `/subscribers/${id}/contracts`));
    await client.call("POST", `/contracts/${contracts[0]?.id}/archive`, {});
    await client.call("POST", `/payers/${payerId}/archive`, {});

    const response = await client.call("POST", `/contracts/${contracts[0]?.id}/restore`, {});

    expect(response.json()).toMatchObject({ code: "restore_blocked", message: "Спершу відновіть платника «Клієнт»" });
  });

  describe("deletion", () => {
    it("removes a client made by mistake with all that came with it, and frees the ID", async () => {
      const { id, code } = await client.createClient({ legacyCode: "S-1" });

      expect((await client.call("DELETE", `/subscribers/${id}`)).statusCode).toBe(204);

      expect(await owner.subscriber.count()).toBe(0);
      expect(await owner.contact.count()).toBe(0);
      expect(await owner.payer.count()).toBe(0);
      expect(await owner.subscriberTariffPeriod.count()).toBe(0);
      const other = await client.createClient({ legacyCode: "S-1" });
      const reused = await client.call("PATCH", `/subscribers/${other.id}/code`, { code: String(code), version: 1 });
      expect(reused.statusCode).toBe(204);
    });

    it("leaves a snapshot in the journal", async () => {
      const { id, code } = await client.createClient({ name: "Помилковий" });

      await client.call("DELETE", `/subscribers/${id}`);

      const event = await owner.activityEvent.findFirstOrThrow({ where: { action: "subscriber.deleted" } });
      expect(event).toMatchObject({ entityId: id, subscriberId: id });
      expect(event.snapshot).toMatchObject({ code, name: "Помилковий" });
    });

    it("keeps a payer who pays for someone else", async () => {
      const { id } = await client.createClient();
      const [payer] = await payersOf(id);
      const other = await client.createClient({ name: "Другий" });
      await client.call("POST", `/subscribers/${other.id}/payers/${payer?.id}/link`, {});

      await client.call("DELETE", `/subscribers/${id}`);

      expect(await owner.payer.count({ where: { id: payer?.id } })).toBe(1);
    });

    it("refuses a client with a contract, even one in the archive", async () => {
      const { id } = await clientWithRecords();
      const contracts = items<{ id: string }>(await client.call("GET", `/subscribers/${id}/contracts`));
      await client.call("POST", `/contracts/${contracts[0]?.id}/archive`, {});

      const response = await client.call("DELETE", `/subscribers/${id}`);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "subscriber_has_contracts" });
    });

    it("refuses while a payer of other clients waits in its archive", async () => {
      const { id } = await client.createClient();
      const [payer] = await payersOf(id);
      const other = await client.createClient({ name: "Другий" });
      await client.call("POST", `/subscribers/${other.id}/payers/${payer?.id}/link`, {});
      await client.call("POST", `/payers/${payer?.id}/archive`, {});

      const response = await client.call("DELETE", `/subscribers/${id}`);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "payer_in_archive" });
      expect(await batches()).toHaveLength(1);
    });

    it("waits for a restore of the same client instead of a deadlock", async () => {
      const { id } = await client.createClient();
      await client.call("POST", `/subscribers/${id}/archive`, {});
      const [batch] = await batches();
      // Both requests queue up behind this lock, the deletion first: the order that used to deadlock
      const release = await holdClient(owner, id);

      const deletion = client.call("DELETE", `/subscribers/${id}`);
      await requestsWaitForLocks(owner, 1);
      const restore = client.call("POST", `/archive/${batch?.id}/restore`, {});
      await requestsWaitForLocks(owner, 2);
      await release();
      const [deleted, restored] = await Promise.all([deletion, restore]);

      expect(deleted.statusCode).toBe(204);
      expect(restored.statusCode).toBe(404);
      expect(await owner.subscriber.count({ where: { id } })).toBe(0);
    });

    it("clears the archive of what will never come back", async () => {
      const { id } = await client.createClient();
      await client.call("POST", `/subscribers/${id}/archive`, {});

      await client.call("DELETE", `/subscribers/${id}`);

      expect(await batches()).toEqual([]);
    });
  });

  describe("the level `own`", () => {
    const setScope = async (scope: "all" | "own") => {
      const role = await owner.role.findUniqueOrThrow({ where: { key: "admin" } });
      await owner.rolePermission.updateMany({ where: { roleId: role.id }, data: { scope } });
    };
    const OWN_KEYS = [
      "subscribers.read",
      "subscribers.write",
      "subscribers.code.change",
      "records.archive",
      "records.delete",
      "activity.read",
    ];
    const setOwn = async () => {
      const role = await owner.role.findUniqueOrThrow({ where: { key: "admin" } });
      await owner.rolePermission.updateMany({
        where: { roleId: role.id, key: { in: OWN_KEYS } },
        data: { scope: "own" },
      });
    };

    async function foreignClient(): Promise<{ id: string; contactId: string; payerId: string; contractId: string }> {
      const { id, payerId } = await clientWithRecords({ name: "Чужий" });
      const stranger = await owner.user.create({
        data: {
          email: `stranger-${id}@example.test`,
          fullName: "Інший менеджер",
          status: "active",
          role: { connect: { key: "manager" } },
        },
      });
      await owner.subscriber.update({ where: { id }, data: { managerId: stranger.id } });
      const contacts = items<{ id: string }>(await client.call("GET", `/subscribers/${id}/contacts`));
      const contracts = items<{ id: string }>(await client.call("GET", `/subscribers/${id}/contracts`));
      return { id, payerId, contactId: contacts[0]?.id ?? "", contractId: contracts[0]?.id ?? "" };
    }

    afterAll(() => setScope("all"));

    it("shows a manager only their clients, in the list, the search and the count", async () => {
      await client.createClient({ name: "Свій" });
      await foreignClient();
      await setOwn();

      const rows = items<SubscriberListItem>(await client.call("GET", "/subscribers"));
      const found = items<SubscriberListItem>(
        await client.call("GET", `/subscribers?q=${encodeURIComponent("чужий")}`),
      );
      const count = await client.call("GET", "/subscribers/count");
      await setScope("all");

      expect(rows.map((row) => row.name)).toEqual(["Свій"]);
      expect(found).toEqual([]);
      expect(count.json()).toEqual({ count: 1, isCapped: false });
    });

    it("hides every record of someone else's client, for reading and for writing", async () => {
      const { id, contactId, payerId, contractId } = await foreignClient();
      await setOwn();

      const answers = await Promise.all([
        client.call("GET", `/subscribers/${id}`),
        client.call("GET", `/subscribers/${id}/contacts`),
        client.call("GET", `/subscribers/${id}/payers`),
        client.call("GET", `/subscribers/${id}/contracts`),
        client.call("GET", `/subscribers/${id}/activity`),
        client.call("POST", `/subscribers/${id}/archive`, {}),
        client.call("DELETE", `/subscribers/${id}`),
        client.call("POST", `/subscribers/${id}/contacts`, SECOND_CONTACT),
        client.call("POST", `/contacts/${contactId}/make-primary`, {}),
        client.call("POST", `/contacts/${contactId}/archive`, {}),
        client.call("POST", `/payers/${payerId}/archive`, {}),
        client.call("POST", `/contracts/${contractId}/archive`, {}),
        client.call("GET", `/contracts/${contractId}/file`),
        uploadFile(client, contractId, "contract.pdf", Buffer.from("%PDF-1.7")),
      ]);
      await setScope("all");

      expect(answers.map((answer) => answer.statusCode)).toEqual(Array(answers.length).fill(404));
      expect(await archived(id)).toBe(false);
    });

    it("hides the contracts and payers of someone else's client in the shared lists", async () => {
      await foreignClient();
      await setOwn();

      const contracts = await client.call("GET", "/contracts");
      const payers = await client.call("GET", "/payers");
      await setScope("all");

      expect(items(contracts)).toEqual([]);
      expect(items(payers)).toEqual([]);
    });

    it("shows a manager only the journal and the archive of their clients", async () => {
      const own = await client.createClient({ name: "Свій" });
      const foreign = await foreignClient();
      await client.call("POST", `/subscribers/${foreign.id}/archive`, {});
      const [batch] = await batches();
      await client.call("POST", `/contacts/${foreign.contactId}/make-primary`, {});
      await client.call("POST", `/subscribers/${own.id}/archive`, {});
      await setOwn();

      const events = await client.call("GET", "/activity?limit=100");
      const archive = await batches();
      const restore = await client.call("POST", `/archive/${batch?.id}/restore`, {});
      await setScope("all");

      const subjects = events.json<{ items: { entityId: string }[] }>().items.map((event) => event.entityId);
      expect(subjects).toContain(own.id);
      expect(subjects).not.toContain(foreign.id);
      expect(archive.map((row) => row.label)).toEqual(["Клієнт: Свій"]);
      expect(restore.statusCode).toBe(404);
      expect(await archived(foreign.id)).toBe(true);
    });

    it("does not read someone else's name through a check", async () => {
      await foreignClient();
      await setOwn();

      const check = await client.call("GET", "/subscribers/code-check?code=10000");
      const legacy = await client.call(
        "GET",
        `/subscribers/duplicates?crmUrl=${encodeURIComponent("https://crm.example.test/1")}`,
      );
      await setScope("all");

      expect(check.json()).toEqual({ isValid: true, isFree: false, holder: null });
      expect(legacy.json()).toEqual({ items: [] });
    });

    it("does not let the filter by manager step over the level", async () => {
      const { id } = await foreignClient();
      const { managerId } = await owner.subscriber.findUniqueOrThrow({ where: { id } });
      await setOwn();

      const rows = await client.call("GET", `/subscribers?managerId=${managerId}`);
      const count = await client.call("GET", `/subscribers/count?managerId=${managerId}`);
      await setScope("all");

      expect(items(rows)).toEqual([]);
      expect(count.json()).toEqual({ count: 0, isCapped: false });
    });

    it("does not read someone else's payer through the check of a contract number", async () => {
      await foreignClient();
      const own = await client.createClient({ name: "Свій" });
      const [payer] = await payersOf(own.id);
      await setOwn();

      const check = await client.call("GET", `/contracts/number-check?number=${CONTRACT.number}&payerId=${payer?.id}`);
      await setScope("all");

      expect(check.json()).toEqual({ samePayer: null, otherPayer: null });
    });

    it("does not bring in a payer it cannot see", async () => {
      const foreign = await foreignClient();
      const own = await client.createClient({ name: "Свій" });
      await setOwn();

      const link = await client.call("POST", `/subscribers/${own.id}/payers/${foreign.payerId}/link`, {});
      const unlink = await client.call("DELETE", `/subscribers/${own.id}/payers/${foreign.payerId}/link`);
      await setScope("all");

      expect([link.statusCode, unlink.statusCode]).toEqual([404, 404]);
      expect(await owner.payerSubscriber.count({ where: { payerId: foreign.payerId } })).toBe(1);
    });

    it("shows of a shared payer only what belongs to this person's clients", async () => {
      const foreign = await foreignClient();
      const own = await client.createClient({ name: "Свій" });
      await client.call("POST", `/subscribers/${own.id}/payers/${foreign.payerId}/link`, {});
      await setOwn();

      const ofCard = items<Payer>(await client.call("GET", `/subscribers/${own.id}/payers`));
      const found = items<Payer>(await client.call("GET", "/payers"));
      await setScope("all");

      const shared = (rows: Payer[]) => rows.find((row) => row.id === foreign.payerId);
      expect(shared(ofCard)).toMatchObject({ otherClients: [], contractNumbers: [] });
      expect(shared(found)?.otherClients.map((row) => row.name)).toEqual(["Свій"]);
      expect(shared(found)?.contractNumbers).toEqual([]);
    });

    it("writes the change of a shared payer under the client this person may see", async () => {
      const foreign = await foreignClient();
      const own = await client.createClient({ name: "Свій" });
      await client.call("POST", `/subscribers/${own.id}/payers/${foreign.payerId}/link`, {});
      await setOwn();

      const [payer] = items<Payer>(await client.call("GET", `/subscribers/${own.id}/payers`)).filter(
        (row) => row.id === foreign.payerId,
      );
      await client.call("PATCH", `/payers/${foreign.payerId}`, {
        name: "Новий платник",
        paymentMethod: payer?.paymentMethod,
        legalName: payer?.legalName,
        taxId: payer?.taxId,
        vchasnoEmail: payer?.vchasnoEmail,
        detailsContact: payer?.detailsContact,
        paymentTermsNote: payer?.paymentTermsNote,
        note: payer?.note,
        version: payer?.version,
      });
      await client.call("POST", `/payers/${foreign.payerId}/archive`, {});
      const archive = await batches();
      await setScope("all");

      const event = await owner.activityEvent.findFirstOrThrow({ where: { action: "payer.updated" } });
      expect(event.subscriberId).toBe(own.id);
      expect(archive.map((row) => row.label)).toContain("Платник: Новий платник");
    });

    it("makes the person who creates a client its manager", async () => {
      await setOwn();

      const { id } = await client.createClient({ managerId: undefined });
      const card = await client.card(id);
      await setScope("all");

      expect(card.managerName).toBeTruthy();
    });
  });
});
