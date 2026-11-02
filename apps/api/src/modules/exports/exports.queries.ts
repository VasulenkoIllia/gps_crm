import type { DbOrTx } from "../../core/db/client.js";

type NameReader = (db: DbOrTx, id: string) => Promise<string | null | undefined>;

const byName = { select: { name: true } } as const;

// One per filter that holds an id, read from the table of its module (02-architecture.md §2.2, rule 5)
const NAME_READERS: Record<string, NameReader> = {
  programId: async (db, id) => (await db.program.findUnique({ where: { id }, ...byName }))?.name,
  serverId: async (db, id) => (await db.monitoringServer.findUnique({ where: { id }, ...byName }))?.name,
  tariffId: async (db, id) => (await db.tariff.findUnique({ where: { id }, ...byName }))?.name,
  modelId: async (db, id) => (await db.trackerModel.findUnique({ where: { id }, ...byName }))?.name,
  addonId: async (db, id) => (await db.addon.findUnique({ where: { id }, ...byName }))?.name,
  operatorId: async (db, id) => (await db.simOperator.findUnique({ where: { id }, ...byName }))?.name,
  contractorId: async (db, id) => (await db.contractor.findUnique({ where: { id }, ...byName }))?.name,
  managerId: async (db, id) => (await db.user.findUnique({ where: { id }, select: { fullName: true } }))?.fullName,
  subscriberId: async (db, id) => {
    const row = await db.subscriber.findUnique({ where: { id }, select: { code: true, name: true } });
    return row && `${row.code} ${row.name}`;
  },
};

// The names behind the ids of the filters, for the line of the journal
export async function readFilterNames(db: DbOrTx, ids: [string, string][]): Promise<Map<string, string>> {
  const found = await Promise.all(
    ids.map(async ([key, id]) => [id, (await NAME_READERS[key]?.(db, id)) ?? null] as const),
  );
  return new Map(found.flatMap(([id, name]) => (name ? [[id, name] as const] : [])));
}
