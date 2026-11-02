import { createWriteStream } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FilesConfig } from "../config.js";

// One way to keep a file (D23): a new place is a new implementation, chosen by FILES_STORAGE. A module never sees a path.
export interface FileStorage {
  readonly name: string;
  prepare: () => Promise<void>;
  put: (key: string, content: Buffer) => Promise<void>;
  // A file too big to hold in memory, such as an export of a whole list: it goes to its place as it is written
  putStream: (key: string, content: Readable) => Promise<void>;
  // Null: the row is there and the file is not, which a person must hear about and a request must survive
  read: (key: string) => Promise<Buffer | null>;
  openStream: (key: string) => Promise<Readable | null>;
  remove: (key: string) => Promise<void>;
  // Every file under a prefix of keys: what the attempts of one export left there, finished or cut short
  removeFolder: (prefix: string) => Promise<void>;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// Keys come from this app and never from a person, so a key cannot climb out of the folder
function localStorage(dir: string): FileStorage {
  return {
    name: "local",
    prepare: async () => {
      await mkdir(dir, { recursive: true });
    },
    put: async (key, content) => {
      const target = join(dir, key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx" });
    },
    putStream: async (key, content) => {
      const target = join(dir, key);
      await mkdir(dirname(target), { recursive: true });
      await pipeline(content, createWriteStream(target, { flags: "wx" }));
    },
    read: (key) =>
      readFile(join(dir, key)).catch((error: unknown) => {
        if (isMissingFile(error)) return null;
        throw error;
      }),
    // Opened before the answer starts, so a missing file is still a 404 and not a cut download
    openStream: async (key) => {
      try {
        const handle = await open(join(dir, key));
        return handle.createReadStream();
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    remove: (key) => rm(join(dir, key), { force: true }),
    removeFolder: (prefix) => rm(join(dir, prefix), { recursive: true, force: true }),
  };
}

export function createFileStorage(config: FilesConfig): FileStorage {
  return localStorage(config.dir);
}
