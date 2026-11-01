import { createHash, randomUUID } from "node:crypto";
import type { DbOrTx } from "../db/client.js";
import type { FileStorage } from "./file-storage.js";

const KEY_PREFIX_LENGTH = 2;

export interface NewFile {
  ownerType: string;
  ownerId: string;
  originalName: string;
  mime: string;
  content: Buffer;
}

export interface PlacedFile {
  key: string;
  sha256: string;
  size: number;
}

export interface StoredFileRow {
  id: string;
  key: string;
  originalName: string;
  mime: string;
  size: number;
}

const FILE_ROW = { id: true, key: true, originalName: true, mime: true, size: true } as const;

// Outside the transaction, before it: a file left behind by a failed one costs a little disk, and the caller removes it.
// A row with no file behind it would be a lie the journal repeats.
export async function placeFile(storage: FileStorage, file: NewFile): Promise<PlacedFile> {
  const id = randomUUID();
  const key = `${file.ownerType}/${id.slice(0, KEY_PREFIX_LENGTH)}/${id}`;
  await storage.put(key, file.content);
  return { key, sha256: createHash("sha256").update(file.content).digest("hex"), size: file.content.length };
}

export async function createFileRecord(
  db: DbOrTx,
  storage: FileStorage,
  file: Omit<NewFile, "content">,
  placed: PlacedFile,
  uploadedBy: string | null,
): Promise<void> {
  await db.storedFile.create({ data: { ...file, ...placed, storage: storage.name, uploadedBy } });
}

export async function findLatestFile(db: DbOrTx, ownerType: string, ownerId: string): Promise<StoredFileRow | null> {
  return db.storedFile.findFirst({ where: { ownerType, ownerId }, orderBy: { id: "desc" }, select: FILE_ROW });
}

// The newest file of each owner: what a list shows beside each row
export async function findLatestFileNames(
  db: DbOrTx,
  ownerType: string,
  ownerIds: string[],
): Promise<Map<string, string>> {
  const rows = await db.storedFile.findMany({
    where: { ownerType, ownerId: { in: ownerIds } },
    orderBy: { id: "desc" },
    distinct: ["ownerId"],
    select: { ownerId: true, originalName: true },
  });
  return new Map(rows.map((row) => [row.ownerId, row.originalName]));
}
