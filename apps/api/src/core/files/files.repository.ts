import { createHash, randomUUID } from "node:crypto";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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

function newKey(ownerType: string): string {
  const id = randomUUID();
  return `${ownerType}/${id.slice(0, KEY_PREFIX_LENGTH)}/${id}`;
}

// Outside the transaction, before it: a file left behind by a failed one costs a little disk, and the caller removes it.
// A row with no file behind it would be a lie the journal repeats.
export async function placeFile(storage: FileStorage, file: NewFile): Promise<PlacedFile> {
  const key = newKey(file.ownerType);
  await storage.put(key, file.content);
  return { key, sha256: createHash("sha256").update(file.content).digest("hex"), size: file.content.length };
}

// As placeFile, for content still being written: the key comes back at once, so the caller can remove what part of
// the file is there when the writing fails. Destroying the content with an error ends the writing; a failure of the
// storage destroys the content in turn.
export function placeFileStream(
  storage: FileStorage,
  ownerType: string,
  content: Readable,
): { key: string; done: Promise<PlacedFile> } {
  const key = newKey(ownerType);
  const hash = createHash("sha256");
  let size = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, next) {
      hash.update(chunk);
      size += chunk.length;
      next(null, chunk);
    },
  });
  // Two halves of one chain, each listening from the first moment: the storage first makes its folder, and an error
  // on either side meanwhile reaches the other instead of the process. The first failure settles `done`, while the
  // storage half may still be making its folder and leave an empty file after the caller removed the key: the folder
  // of the owner goes with it later (exports.build.ts).
  const done = Promise.all([pipeline(content, counted), storage.putStream(key, counted)]).then((): PlacedFile => ({
    key,
    sha256: hash.digest("hex"),
    size,
  }));
  // Handled where it is awaited; until then a rejection must not count as unhandled
  done.catch(() => undefined);
  return { key, done };
}

export async function createFileRecord(
  db: DbOrTx,
  storage: FileStorage,
  file: Omit<NewFile, "content">,
  placed: PlacedFile,
  uploadedBy: string | null,
): Promise<string> {
  const row = await db.storedFile.create({
    data: { ...file, ...placed, storage: storage.name, uploadedBy },
    select: { id: true },
  });
  return row.id;
}

export async function deleteFileRecord(db: DbOrTx, id: string): Promise<void> {
  await db.storedFile.delete({ where: { id } });
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
