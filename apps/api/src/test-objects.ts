import {
  addDays,
  firstOfNextMonth,
  todayKyiv,
  type ObjectCard,
  type ObjectHistory,
  type Payer,
  type RoleKey,
} from "@gps_crm/shared";
import type { DbClient } from "./core/db/client.js";
import { resetClients, startClientApi, type ClientApi } from "./test-clients.js";
import { items } from "./test-references.js";

export const TODAY = todayKyiv();
export const YESTERDAY = addDays(TODAY, -1);
export const WEEK_AGO = addDays(TODAY, -7);
export const MONTH_AGO = addDays(TODAY, -30);
export const NEXT_MONTH = firstOfNextMonth(TODAY);

const IMEI_BASE = 100_000_000_000_000;
const ICCID_LENGTH = 17;
let lastNumber = 0;

function nextNumber(): number {
  lastNumber += 1;
  return lastNumber;
}

export function nextImei(): string {
  return String(IMEI_BASE + nextNumber());
}

export function nextIccid(): string {
  return `89${String(nextNumber()).padStart(ICCID_LENGTH, "0")}`;
}

export interface ObjectApi extends ClientApi {
  subscriberId: string;
  payerId: string;
  objectForm: (fields?: object) => object;
  createObject: (fields?: object) => Promise<string>;
  objectCard: (id: string) => Promise<ObjectCard>;
  history: (id: string) => Promise<ObjectHistory>;
  payersOf: (subscriberId: string) => Promise<Payer[]>;
  addPayer: (name: string) => Promise<string>;
}

export async function startObjectApi(db: DbClient, owner: DbClient): Promise<ObjectApi> {
  // On the same object and not a copy: resetClients sets the place on what it gets, and createClient reads it there
  const client = await startClientApi(db, owner);
  const self: ObjectApi = Object.assign(client, {
    subscriberId: "",
    payerId: "",
    objectForm: (fields: object = {}) => ({
      subscriberId: self.subscriberId,
      name: "Об'єкт",
      status: "active",
      statusFrom: MONTH_AGO,
      connectedOn: MONTH_AGO,
      device: { imei: nextImei() },
      installedOn: MONTH_AGO,
      sim: { iccid: nextIccid() },
      payerId: self.payerId,
      ...fields,
    }),
    createObject: async (fields?: object) => {
      const response = await self.call("POST", "/objects", self.objectForm(fields));
      if (response.statusCode !== 201) throw new Error(`POST /objects: ${response.statusCode} ${response.body}`);
      return response.json<{ id: string }>().id;
    },
    objectCard: async (id: string) => (await self.call("GET", `/objects/${id}`)).json<ObjectCard>(),
    history: async (id: string) => (await self.call("GET", `/objects/${id}/history`)).json<ObjectHistory>(),
    payersOf: async (subscriberId: string) => {
      return items<Payer>(await self.call("GET", `/subscribers/${subscriberId}/payers`));
    },
    addPayer: async (name: string) => {
      const payer = { name, paymentMethod: "iban", detailsContact: "0671234567" };
      const response = await self.call("POST", `/subscribers/${self.subscriberId}/payers`, payer);
      return response.json<{ id: string }>().id;
    },
  });
  return self;
}

// A client with its payer and nothing else, ready for an object. Runs before each test, after the rows are cleared.
export async function resetObjects(client: ObjectApi, owner: DbClient): Promise<void> {
  await resetClients(client, owner);
  client.subscriberId = (await client.createClient()).id;
  const [payer] = await client.payersOf(client.subscriberId);
  client.payerId = payer?.id ?? "";
}

export async function createReason(client: ObjectApi, name = "Причина"): Promise<string> {
  return client.create("/disconnect-reasons", { name });
}

// Level of a role for one permission, the way the role screen will set it
export async function setScope(
  owner: DbClient,
  key: string,
  scope: "all" | "own",
  roleKey: RoleKey = "admin",
): Promise<void> {
  const role = await owner.role.findUniqueOrThrow({ where: { key: roleKey } });
  await owner.rolePermission.update({ where: { roleId_key: { roleId: role.id, key } }, data: { scope } });
}
