import type { DbOrTx } from "../../core/db/client.js";

export interface ArchiveBatchInput {
  entityType: string;
  label: string;
  itemCount: number;
  archivedBy: string | null;
  subscriberId?: string;
}

export async function createArchiveBatch(db: DbOrTx, input: ArchiveBatchInput): Promise<string> {
  const { id } = await db.archiveBatch.create({ data: input, select: { id: true } });
  return id;
}

export interface LockedBatch {
  id: string;
  entityType: string;
  itemCount: number;
  subscriberId: string | null;
  isRestored: boolean;
}

// Under the row lock: two people pressing «Відновити» must not restore one package twice
export async function lockArchiveBatch(db: DbOrTx, id: string): Promise<LockedBatch | null> {
  const rows = await db.$queryRaw<LockedBatch[]>`
    SELECT id::text AS id, entity_type AS "entityType", item_count AS "itemCount",
      subscriber_id::text AS "subscriberId", restored_at IS NOT NULL AS "isRestored"
    FROM archive_batches WHERE id = ${id}::uuid FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function isManagerOfSubscriber(db: DbOrTx, subscriberId: string, managerId: string): Promise<boolean> {
  const count = await db.subscriber.count({ where: { id: subscriberId, managerId } });
  return count > 0;
}

export async function lockOpenBatches(db: DbOrTx, subscriberId: string): Promise<void> {
  await db.$queryRaw`
    SELECT 1 FROM archive_batches
    WHERE subscriber_id = ${subscriberId}::uuid AND restored_at IS NULL
    ORDER BY id FOR UPDATE
  `;
}

export async function findOpenBatchIds(db: DbOrTx, subscriberId: string): Promise<string[]> {
  const rows = await db.archiveBatch.findMany({ where: { subscriberId, restoredAt: null }, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function deleteOpenBatches(db: DbOrTx, subscriberId: string): Promise<void> {
  await db.archiveBatch.deleteMany({ where: { subscriberId, restoredAt: null } });
}

export async function markBatchRestored(db: DbOrTx, id: string, restoredBy: string | null): Promise<void> {
  await db.archiveBatch.update({ where: { id }, data: { restoredAt: new Date(), restoredBy } });
}
