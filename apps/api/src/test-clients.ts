import type { LightMyRequestResponse } from "fastify";
import { firstOfNextMonth, todayKyiv, type SubscriberCard } from "@gps_crm/shared";
import type { DbClient } from "./core/db/client.js";
import { clearClientData } from "./core/db/test-database.js";
import {
  clearReferences,
  createPlace,
  createTariff,
  startReferenceClient,
  type PlaceIds,
  type ReferenceClient,
} from "./test-references.js";
import { api } from "./test-auth.js";

export interface ClientApi extends ReferenceClient {
  place: PlaceIds;
  tariffId: string;
  call: (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
  ) => Promise<LightMyRequestResponse>;
  createClient: (fields?: object) => Promise<{ id: string; code: number }>;
  card: (id: string) => Promise<SubscriberCard>;
}

export const NEXT_FIRST = firstOfNextMonth(todayKyiv());
// Valid by their check digits, and nobody's
export const EDRPOU = "12345678";
export const OTHER_EDRPOU = "87654322";
export const IPN = "1234567899";

export function clientForm(api: Pick<ClientApi, "place" | "tariffId">, fields: object = {}) {
  return {
    type: "B2C",
    name: "Клієнт",
    crmUrl: "https://crm.example.test/1",
    graceDays: 0,
    programId: api.place.programId,
    tariffId: api.tariffId,
    tariffValidFrom: NEXT_FIRST,
    contact: { fullName: "Контактна особа", phone: "0671234567", channel: "email", email: "contact@example.test" },
    payer: { paymentMethod: "iban", detailsContact: "0671234567" },
    ...fields,
  };
}

export function companyForm(api: Pick<ClientApi, "place" | "tariffId">, fields: object = {}) {
  return clientForm(api, {
    type: "B2B",
    name: "ТОВ Клієнт",
    taxId: EDRPOU,
    payer: { paymentMethod: "invoice", legalName: "Товариство Клієнт" },
    ...fields,
  });
}

export function updateForm(card: SubscriberCard, fields: object = {}) {
  const { type, name, taxId, crmUrl, managerId, graceDays, discountKop, legacyCode, note, version } = card;
  return { type, name, taxId, crmUrl, managerId, graceDays, discountKop, legacyCode, note, version, ...fields };
}

export async function startClientApi(db: DbClient, owner: DbClient): Promise<ClientApi> {
  await clearClientData(owner);
  const client = await startReferenceClient(db, owner);
  const self: ClientApi = {
    ...client,
    place: { programId: "", serverId: "" },
    tariffId: "",
    call: (method, path, payload) => api(client.app, method, path, { cookie: client.cookie, payload }),
    createClient: async (fields) => {
      const response = await self.call("POST", "/subscribers", clientForm(self, fields));
      if (response.statusCode !== 201) throw new Error(`POST /subscribers: ${response.statusCode} ${response.body}`);
      return response.json();
    },
    card: async (id) => (await self.call("GET", `/subscribers/${id}`)).json(),
  };
  return self;
}

// A program with one tariff, ready for a client. Runs before each test, after the rows are cleared.
export async function resetClients(client: ClientApi, owner: DbClient): Promise<void> {
  await clearClientData(owner);
  await clearReferences(owner);
  client.place = await createPlace(client);
  client.tariffId = await createTariff(client, client.place);
}

const BOUNDARY = "boundary-of-the-test";

function multipart(fileName: string, content: Buffer): Buffer {
  const head = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  return Buffer.concat([Buffer.from(head), content, Buffer.from(`\r\n--${BOUNDARY}--\r\n`)]);
}

export function uploadFile(
  client: Pick<ClientApi, "app" | "cookie">,
  contractId: string,
  fileName: string,
  content: Buffer,
): Promise<LightMyRequestResponse> {
  return api(client.app, "POST", `/contracts/${contractId}/file`, {
    cookie: client.cookie,
    headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
    payload: multipart(fileName, content),
  });
}
