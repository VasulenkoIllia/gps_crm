import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { APP_ROLE_NAME } from "./app-role.repository.js";
import { createDbClient, type DbClient } from "./client.js";

const LOCAL_ENV_FILE = resolve(import.meta.dirname, "../../../../../.env");
const TEST_DATABASE_SUFFIX = "_test";

// Integration tests migrate and write, so they accept only a database named *_test: a server reached through an SSH
// tunnel looks exactly like the local one, and neither it nor the dev database may ever land here.
export function testDatabaseUrl(): string {
  if (existsSync(LOCAL_ENV_FILE)) process.loadEnvFile(LOCAL_ENV_FILE);
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is not set: integration tests need real PostgreSQL");
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new Error(`TEST_DATABASE_URL must name a *${TEST_DATABASE_SUFFIX} database, not ${name}`);
  }
  return databaseUrl;
}

export function testAppRolePassword(): string {
  testDatabaseUrl();
  const password = process.env.APP_DB_PASSWORD;
  if (!password) throw new Error("APP_DB_PASSWORD is not set: tests connect as the runtime role");
  return password;
}

export function testAppDatabaseUrl(): string {
  const url = new URL(testDatabaseUrl());
  url.username = APP_ROLE_NAME;
  url.password = testAppRolePassword();
  return url.toString();
}

function failOnPoolError(error: Error): never {
  throw error;
}

// The schema owner: infra/compose.dev.yml locally, a service container in CI. For setting a test up, not for the app.
export function connectTestDatabase(): DbClient {
  return createDbClient(testDatabaseUrl(), failOnPoolError);
}

// What the app itself connects as: every route is tested with the grants production has
export function connectTestAppDatabase(profile?: Parameters<typeof createDbClient>[2]): DbClient {
  return createDbClient(testAppDatabaseUrl(), failOnPoolError, profile);
}

const STARTING_SERIES = [
  { name: "Фізособи", rangeFrom: 10_000n, rangeTo: 49_999n, types: ["B2C"] },
  { name: "Юрособи", rangeFrom: 50_000n, rangeTo: 99_999n, types: ["B2B", "B2G"] },
] as const;

// Everything of the clients, and the series as the migration left them. Here and not in the module: the tables hold
// users and tariffs by foreign keys, so the helpers that clear those come through this first.
export async function clearClientData(owner: DbClient): Promise<void> {
  await owner.sensorInstallation.deleteMany();
  await owner.simInstallation.deleteMany();
  await owner.deviceInstallation.deleteMany();
  await owner.objectAddonPeriod.deleteMany();
  await owner.objectServiceTerm.deleteMany();
  await owner.objectStatusPeriod.deleteMany();
  await owner.monitoredObject.deleteMany();
  await owner.device.deleteMany();
  await owner.sim.deleteMany();
  await owner.sensor.deleteMany();
  await owner.storedFile.deleteMany();
  await owner.contract.deleteMany();
  await owner.contact.deleteMany();
  await owner.payerSubscriber.deleteMany();
  await owner.payer.deleteMany();
  await owner.subscriberTariffPeriod.deleteMany();
  await owner.subscriber.deleteMany();
  await owner.subscriberIdSeriesType.deleteMany();
  await owner.subscriberIdSeries.deleteMany();
  for (const { types, name, rangeFrom, rangeTo } of STARTING_SERIES) {
    const nameNorm = name.toLowerCase();
    await owner.subscriberIdSeries.create({
      data: {
        name,
        nameNorm,
        rangeFrom,
        rangeTo,
        nextNumber: rangeFrom,
        types: { create: types.map((type) => ({ type })) },
      },
    });
  }
}
