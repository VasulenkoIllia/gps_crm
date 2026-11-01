import type { DbOrTx } from "../../core/db/client.js";

export interface ArchiveBatchInput {
  entityType: string;
  label: string;
  itemCount: number;
  archivedBy: string | null;
}

export async function createArchiveBatch(db: DbOrTx, input: ArchiveBatchInput): Promise<string> {
  const { id } = await db.archiveBatch.create({ data: input, select: { id: true } });
  return id;
}

export interface LockedBatch {
  id: string;
  entityType: string;
  itemCount: number;
  isRestored: boolean;
}

// Under the row lock: two people pressing «Відновити» must not restore one package twice
export async function lockArchiveBatch(db: DbOrTx, id: string): Promise<LockedBatch | null> {
  const rows = await db.$queryRaw<LockedBatch[]>`
    SELECT id::text AS id, entity_type AS "entityType", item_count AS "itemCount", restored_at IS NOT NULL AS "isRestored"
    FROM archive_batches WHERE id = ${id}::uuid FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function markBatchRestored(db: DbOrTx, id: string, restoredBy: string | null): Promise<void> {
  await db.archiveBatch.update({ where: { id }, data: { restoredAt: new Date(), restoredBy } });
}
