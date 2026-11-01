import type { PermissionKey } from "@gps_crm/shared";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "./app.js";
import type { DbClient } from "./core/db/client.js";
import { clearClientData } from "./core/db/test-database.js";
import { NO_JOBS, NO_MAIL, testConfig } from "./core/test-app.js";
import { api, clearAuthData, createUser, signInWithSetup } from "./test-auth.js";

const FIRST_OF_YEAR = "2026-01-01";

// Dependents first: nothing here cascades, on purpose
export async function clearReferences(owner: DbClient): Promise<void> {
  await clearClientData(owner);
  await owner.costPrice.deleteMany();
  await owner.addonPrice.deleteMany();
  await owner.addonProgram.deleteMany();
  await owner.addon.deleteMany();
  await owner.tariff.deleteMany();
  await owner.monitoringServer.deleteMany();
  await owner.simPlan.deleteMany();
  await owner.simOperator.deleteMany();
  await owner.program.deleteMany();
  await owner.trackerModel.deleteMany();
  await owner.contractor.deleteMany();
  await owner.disconnectReason.deleteMany();
  await owner.archiveBatch.deleteMany();
  await owner.activityEvent.deleteMany();
}

export interface ReferenceClient {
  app: FastifyInstance;
  cookie: string;
  get: (path: string) => Promise<LightMyRequestResponse>;
  post: (path: string, payload?: object) => Promise<LightMyRequestResponse>;
  patch: (path: string, payload: object) => Promise<LightMyRequestResponse>;
  // The id of what a POST created; a refusal fails the test with the answer in the message
  create: (path: string, payload: object) => Promise<string>;
  journal: (action: string) => Promise<JournalLine[]>;
}

export interface JournalLine {
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  changes: { field: string; before: unknown; after: unknown }[];
  details: { field: string; value: unknown }[];
}

// One app and one sign-in for a file: a sign-in hashes for real, and the rows are cleared between the tests instead
export async function startReferenceClient(db: DbClient, owner: DbClient): Promise<ReferenceClient> {
  const app = await buildApp({
    db,
    config: testConfig(),
    mailer: NO_MAIL,
    jobs: NO_JOBS,
    checkReady: () => Promise.resolve(),
  });
  await clearReferences(owner);
  await clearAuthData(owner);
  const admin = await createUser(owner, { email: "admin@example.test", roleKey: "admin" });
  const { cookie } = await signInWithSetup(app, owner, admin);

  const post = (path: string, payload: object = {}) => api(app, "POST", `/references${path}`, { cookie, payload });
  return {
    app,
    cookie,
    post,
    get: (path) => api(app, "GET", `/references${path}`, { cookie }),
    patch: (path, payload) => api(app, "PATCH", `/references${path}`, { cookie, payload }),
    create: async (path, payload) => {
      const response = await post(path, payload);
      if (response.statusCode !== 201) throw new Error(`POST ${path}: ${response.statusCode} ${response.body}`);
      return response.json<{ id: string }>().id;
    },
    journal: async (action) => {
      const response = await api(app, "GET", `/activity?action=${action}`, { cookie });
      return response.json<{ items: JournalLine[] }>().items;
    },
  };
}

export const items = <T>(response: LightMyRequestResponse) => response.json<{ items: T[] }>().items;

// Without one permission for the length of a call, the way the role module will take it away one day
export async function withoutPermission<T>(owner: DbClient, key: PermissionKey, work: () => Promise<T>): Promise<T> {
  const role = await owner.role.findUniqueOrThrow({ where: { key: "admin" } });
  await owner.rolePermission.delete({ where: { roleId_key: { roleId: role.id, key } } });
  try {
    return await work();
  } finally {
    await owner.rolePermission.create({ data: { roleId: role.id, key, scope: "all" } });
  }
}

export interface PlaceIds {
  programId: string;
  serverId: string;
}

export async function createPlace(
  client: ReferenceClient,
  program = "Програма 1",
  server = "Сервер 1",
): Promise<PlaceIds> {
  const programId = await client.create("/programs", { name: program });
  const serverId = await client.create("/servers", { programId, name: server });
  return { programId, serverId };
}

export function createTariff(
  client: ReferenceClient,
  place: PlaceIds,
  fields: { name?: string; billingModel?: "month" | "year"; priceKop?: number } = {},
): Promise<string> {
  return client.create("/tariffs", { name: "Тариф 1", billingModel: "month", priceKop: 10_000, ...place, ...fields });
}

export function createAddon(client: ReferenceClient, programIds: string[], name = "Послуга 1"): Promise<string> {
  return client.create("/addons", { name, programIds, price: { amountKop: 15_000, validFrom: FIRST_OF_YEAR } });
}

// Every shape the lists take: one name by the month and by the year, several programs, addons of one program
export async function seedSampleTable(client: ReferenceClient): Promise<void> {
  const first = await createPlace(client, "Програма 1", "Сервер 1");
  const second = await createPlace(client, "Програма 2", "Сервер 2");
  const tariffs = [
    [first, "Тариф 1", "month", 10_000],
    [first, "Тариф 1", "year", 100_000],
    [first, "Тариф 2", "month", 20_000],
    [first, "Тариф 2", "year", 200_000],
    [second, "Тариф 3", "month", 30_000],
    [second, "Тариф 3", "year", 300_000],
    [second, "Тариф 4", "year", 400_000],
  ] as const;
  for (const [place, name, billingModel, priceKop] of tariffs) {
    await createTariff(client, place, { name, billingModel, priceKop });
  }
  await createAddon(client, [first.programId], "Послуга 1");
  await createAddon(client, [first.programId], "Послуга 2");
  await createAddon(client, [first.programId], "Послуга 3");
}
