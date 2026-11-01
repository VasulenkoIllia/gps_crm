import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";

const DUMP_FILE = "dump.json";
const CHECK_FILE = "check.json";
const FILE_NOT_FOUND = "ENOENT";

// What infra/scripts/backup.sh writes. Not strict: a newer script may add a field, and the screen must not go red for it.
const runSchema = z.object({
  finishedAt: z.iso.datetime(),
  ok: z.boolean(),
  reason: z.string().nullable(),
  lastOkAt: z.iso.datetime().nullable(),
  dumpBytes: z.number().optional(),
  copies: z.number().optional(),
  tables: z.number().optional(),
  // false: the dump predates a migration, so backup.sh compared neither the tables nor the grants
  tablesCompared: z.boolean().optional(),
});
export type BackupRun = z.infer<typeof runSchema>;

export type BackupFile = { kind: "missing" } | { kind: "broken" } | { kind: "read"; run: BackupRun };

type StatusLogger = Pick<Logger, "warn">;

async function readRun(path: string, logger: StatusLogger): Promise<BackupFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === FILE_NOT_FOUND) return { kind: "missing" };
    logger.warn({ path, code }, "backup status file cannot be read");
    return { kind: "broken" };
  }
  try {
    return { kind: "read", run: runSchema.parse(JSON.parse(text)) };
  } catch (error) {
    // The script replaces a file in one move, so this is a real fault, and the screen says so
    logger.warn({ path, reason: (error as Error).name }, "backup status file does not parse");
    return { kind: "broken" };
  }
}

export async function readBackupFiles(
  dir: string | null,
  logger: StatusLogger,
): Promise<{ dump: BackupFile; check: BackupFile }> {
  if (!dir) return { dump: { kind: "missing" }, check: { kind: "missing" } };
  const [dump, check] = await Promise.all([
    readRun(join(dir, DUMP_FILE), logger),
    readRun(join(dir, CHECK_FILE), logger),
  ]);
  return { dump, check };
}
