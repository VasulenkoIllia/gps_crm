import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// backup.sh runs for real against stand-ins for docker, flock and df. PostgreSQL itself is rehearsed on staging: this
// holds the part that deletes files and the part that decides what a failed run looks like.
const FAKE_DOCKER = `#!/bin/sh
echo "$*" >>"$FAKE_DIR/docker.log"
case "$*" in
  ps*) printf '%b\\n' "$FAKE_DB_CONTAINERS" ;;
  inspect*) echo postgres:18-alpine ;;
  run* | logs*) ;;
  rm*)
    echo "Error response from daemon: No such container: $4" >&2
    [ ! -e "$FAKE_DIR/restored" ] || exit "$FAKE_RM_AFTER_RESTORE_EXIT"
    exit "$FAKE_RM_EXIT" ;;
  *pg_isready*) ;;
  *pg_dump*) printf 'dump bytes'; exit "$FAKE_DUMP_EXIT" ;;
  *"pg_restore -f /dev/null"*) cat >/dev/null; exit "$FAKE_READ_BACK_EXIT" ;;
  *pg_restore*)
    cat >/dev/null
    : >"$FAKE_DIR/restored"
    [ "$FAKE_RESTORE_EXIT" = 0 ] || echo 'pg_restore: error: COPY failed for table "payers": ERROR: value UA123456' >&2
    exit "$FAKE_RESTORE_EXIT" ;;
  *restore-check*psql*)
    case "$(cat)" in
      *_prisma_migrations*) echo "$FAKE_RESTORED_HEAD" ;;
      *) printf '%b\\n' "$FAKE_RESTORED_ROWS" ;;
    esac ;;
  *psql*)
    case "$(cat)" in
      *_prisma_migrations*) echo "$FAKE_LIVE_HEAD" ;;
      *) printf '%b\\n' "$FAKE_LIVE_ROWS" ;;
    esac ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
`;
const FAKE_FLOCK = `#!/bin/sh
case "$1" in
  -n) exit "$FAKE_CHECK_LOCK_EXIT" ;;
  *) exit "$FAKE_FLOCK_EXIT" ;;
esac
`;
const FAKE_TIMEOUT = `#!/bin/sh
shift 2
exec "$@"
`;
const FAKE_DF = `#!/bin/sh
echo "Filesystem 1024-blocks Used Available Capacity Mounted"
echo "/dev/fake 1000000000 1 $FAKE_FREE_KB 1% /"
`;

const SCRIPT = join(import.meta.dirname, "scripts", "backup.sh");

interface Status {
  ok: boolean;
  reason: string | null;
  lastOkAt: string | null;
  dumpBytes?: number;
  copies?: number;
  dump?: string;
  tables?: number;
  tablesCompared?: boolean;
}

describe("backup.sh", () => {
  let root: string;
  let envDir: string;
  let dumpDir: string;

  const seed = (...names: string[]) => {
    mkdirSync(dumpDir, { recursive: true });
    for (const name of names) writeFileSync(join(dumpDir, name), name);
  };
  const dumps = (prefix: string) => readdirSync(dumpDir).filter((name) => name.startsWith(`${prefix}-`));
  const dockerCalls = () => readFileSync(join(root, "docker.log"), "utf8");
  const status = (mode: string) =>
    JSON.parse(readFileSync(join(envDir, "backup-status", `${mode}.json`), "utf8")) as Status;

  const run = (mode: string, env: Record<string, string> = {}, environment = "staging") =>
    spawnSync("bash", [join(root, "gps_crm_deploy", "backup.sh"), environment, mode], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        FAKE_DIR: root,
        FAKE_DB_CONTAINERS: "gps_crm_staging-db-1",
        FAKE_FLOCK_EXIT: "0",
        FAKE_CHECK_LOCK_EXIT: "0",
        FAKE_RM_EXIT: "0",
        FAKE_RM_AFTER_RESTORE_EXIT: "0",
        FAKE_FREE_KB: "100000000",
        FAKE_DUMP_EXIT: "0",
        FAKE_READ_BACK_EXIT: "0",
        FAKE_RESTORE_EXIT: "0",
        FAKE_LIVE_HEAD: "20261031120000_foundation",
        FAKE_RESTORED_HEAD: "20261031120000_foundation",
        FAKE_LIVE_ROWS: "public._prisma_migrations\t1\npublic.users\t100",
        FAKE_RESTORED_ROWS: "public._prisma_migrations\t1\npublic.users\t90",
        ...env,
      },
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gps_crm-backup-test-"));
    envDir = join(root, "gps_crm_staging");
    dumpDir = join(envDir, "backups");
    mkdirSync(envDir);
    mkdirSync(join(root, "gps_crm_deploy"));
    mkdirSync(join(root, "bin"));
    copyFileSync(SCRIPT, join(root, "gps_crm_deploy", "backup.sh"));
    for (const [name, body] of [
      ["docker", FAKE_DOCKER],
      ["flock", FAKE_FLOCK],
      ["timeout", FAKE_TIMEOUT],
      ["df", FAKE_DF],
    ] as const) {
      writeFileSync(join(root, "bin", name), body);
      chmodSync(join(root, "bin", name), 0o755);
    }
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("refuses an unknown environment or mode without writing anything", () => {
    expect(run("dump", {}, "demo").status).toBe(64);
    expect(run("everything").status).toBe(64);
    expect(existsSync(join(envDir, "backup-status"))).toBe(false);
  });

  it("does not create the folder of an environment that is not there", () => {
    expect(run("dump", {}, "production").status).toBe(78);
    expect(existsSync(join(root, "gps_crm_production"))).toBe(false);
  });

  describe("dump", () => {
    it("writes a dump, its daily and weekly copies and the status", () => {
      const result = run("dump");

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(dumps("scheduled")).toHaveLength(1);
      expect(dumps("daily")).toHaveLength(1);
      expect(dumps("weekly")).toHaveLength(1);
      expect(readdirSync(dumpDir).filter((name) => name.endsWith(".part"))).toEqual([]);
      const written = status("dump");
      expect(written).toMatchObject({ ok: true, reason: null, dumpBytes: 10, copies: 1 });
      expect(written.lastOkAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });

    it("adds no second daily or weekly copy on the same day", () => {
      expect(run("dump").status).toBe(0);
      expect(run("dump").status).toBe(0);

      expect(dumps("daily")).toHaveLength(1);
      expect(dumps("weekly")).toHaveLength(1);
    });

    it("keeps the newest of each row and leaves the deploy dumps to deploy.sh", () => {
      const names = (count: number, name: (index: number) => string) =>
        Array.from({ length: count }, (_, index) => name(index + 10));
      seed(
        ...names(9, (day) => `scheduled-202001${day}-000000.dump`),
        ...names(9, (day) => `daily-202001${day}.dump`),
        ...names(6, (week) => `weekly-2020W${week}.dump`),
        ...names(12, (day) => `predeploy-202001${day}-000000-sha-abc.dump`),
      );

      expect(run("dump").status).toBe(0);

      expect(dumps("scheduled")).toHaveLength(8);
      expect(dumps("scheduled")).not.toContain("scheduled-20200111-000000.dump");
      expect(dumps("scheduled")).toContain("scheduled-20200112-000000.dump");
      expect(dumps("daily")).toHaveLength(7);
      expect(dumps("daily")).not.toContain("daily-20200112.dump");
      expect(dumps("daily")).toContain("daily-20200113.dump");
      expect(dumps("weekly")).toHaveLength(4);
      expect(dumps("weekly")).not.toContain("weekly-2020W12.dump");
      expect(dumps("weekly")).toContain("weekly-2020W13.dump");
      expect(dumps("predeploy")).toHaveLength(12);
      // Today's dump is one file under three names, and it counts once
      expect(status("dump").copies).toBe(8 + 6 + 3 + 12);
    });

    it("clears nothing and keeps the last success when the dump does not read back", () => {
      expect(run("dump").status).toBe(0);
      const lastOkAt = status("dump").lastOkAt;
      seed(...Array.from({ length: 9 }, (_, index) => `scheduled-2020011${index}-000000.dump`));

      expect(run("dump", { FAKE_READ_BACK_EXIT: "1" }).status).toBe(1);

      expect(dumps("scheduled")).toHaveLength(10);
      expect(readdirSync(dumpDir).filter((name) => name.endsWith(".part"))).toEqual([]);
      expect(status("dump")).toMatchObject({ ok: false, reason: "read-back", lastOkAt });
      expect(status("dump").dumpBytes).toBeUndefined();
    });

    it("reports a failed pg_dump", () => {
      expect(run("dump", { FAKE_DUMP_EXIT: "1" }).status).toBe(1);

      expect(status("dump")).toMatchObject({ ok: false, reason: "dump", lastOkAt: null });
      expect(dumps("scheduled")).toEqual([]);
    });

    it("does not start on a disk with too little room", () => {
      seed("scheduled-20200110-000000.dump");

      expect(run("dump", { FAKE_FREE_KB: "1024" }).status).toBe(1);

      expect(status("dump")).toMatchObject({ ok: false, reason: "disk" });
      expect(dockerCalls()).not.toContain("pg_dump");
    });

    it.each([
      ["no", ""],
      ["more than one", "gps_crm_staging-db-1\\ngps_crm_staging-db-2"],
    ])("stops when %s healthy db container is found", (_, containers) => {
      expect(run("dump", { FAKE_DB_CONTAINERS: containers }).status).toBe(1);

      expect(status("dump")).toMatchObject({ ok: false, reason: "no-db" });
      expect(dockerCalls()).not.toContain("pg_dump");
    });

    it("keeps the good status when a new one cannot be written, and fails the run", () => {
      expect(run("dump").status).toBe(0);
      const before = readFileSync(join(envDir, "backup-status", "dump.json"), "utf8");
      mkdirSync(join(envDir, "backup-status", "dump.json.tmp"));

      const result = run("dump");

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("could not write the status file");
      expect(readFileSync(join(envDir, "backup-status", "dump.json"), "utf8")).toBe(before);
    });

    it("removes what a killed check left behind", () => {
      expect(run("dump").status).toBe(0);

      expect(dockerCalls()).toContain("rm -f -v gps_crm_staging-restore-check");
    });

    it("leaves the throwaway database alone while a check runs", () => {
      expect(run("dump", { FAKE_CHECK_LOCK_EXIT: "1" }).status).toBe(0);

      expect(dockerCalls()).not.toContain("rm -f -v");
    });

    it("does not lose a good dump to a lock file it cannot open", () => {
      mkdirSync(join(envDir, ".restore-check.lock"));

      const result = run("dump");

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("a leftover check was not looked for");
      expect(status("dump").ok).toBe(true);
    });

    it("does not lose a good dump to a failed cleanup of a leftover", () => {
      const result = run("dump", { FAKE_RM_EXIT: "1" });

      expect(result.status).toBe(0);
      expect(result.stderr).toContain("still on the disk: Error response from daemon");
      expect(status("dump").ok).toBe(true);
    });

    it("reports a deploy that kept the lock", () => {
      expect(run("dump", { FAKE_FLOCK_EXIT: "1" }).status).toBe(1);

      expect(status("dump")).toMatchObject({ ok: false, reason: "lock" });
      expect(existsSync(join(root, "docker.log"))).toBe(false);
    });
  });

  describe("check", () => {
    beforeEach(() => {
      seed("scheduled-20200110-000000.dump", "predeploy-20300101-000000-sha-abc.dump");
    });

    it("restores the newest scheduled dump into a throwaway database and removes it with its volume", () => {
      const result = run("check");

      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(status("check")).toMatchObject({
        ok: true,
        reason: null,
        dump: "scheduled-20200110-000000.dump",
        tables: 2,
        tablesCompared: true,
      });
      const calls = dockerCalls();
      expect(calls).toContain("--network none");
      expect(calls).toContain("default_transaction_read_only=on");
      expect(calls.trim().split("\n").at(-1)).toBe("rm -f -v gps_crm_staging-restore-check");
    });

    it("does not take a deploy dump for a good one", () => {
      rmSync(join(dumpDir, "scheduled-20200110-000000.dump"));

      expect(run("check").status).toBe(1);

      expect(status("check")).toMatchObject({ ok: false, reason: "no-dump" });
    });

    it("does not start next to a running check", () => {
      expect(run("check", { FAKE_CHECK_LOCK_EXIT: "1" }).status).toBe(1);

      expect(status("check")).toMatchObject({ ok: false, reason: "busy" });
      expect(existsSync(join(root, "docker.log"))).toBe(false);
    });

    it("fails a passed run whose restored copy could not be removed", () => {
      const result = run("check", { FAKE_RM_AFTER_RESTORE_EXIT: "1" });

      expect(result.status).toBe(1);
      expect(status("check")).toMatchObject({ ok: false, reason: "cleanup" });
      expect(result.stderr).toContain("still on the disk");
    });

    it("fails on a dump that does not restore, and still removes the container", () => {
      const result = run("check", { FAKE_RESTORE_EXIT: "1" });

      expect(result.status).toBe(1);
      expect(status("check")).toMatchObject({ ok: false, reason: "restore" });
      expect(result.stderr).toContain('COPY failed for table "payers"');
      expect(result.stderr).toContain("did not restore, exit 1");
      expect(result.stderr).not.toContain("UA123456");
      expect(dockerCalls().trim().split("\n").at(-1)).toBe("rm -f -v gps_crm_staging-restore-check");
    });

    it("fails when a table is lost at the same migration", () => {
      const result = run("check", { FAKE_RESTORED_ROWS: "public._prisma_migrations\t1" });

      expect(result.status).toBe(1);
      expect(status("check")).toMatchObject({ ok: false, reason: "tables" });
      expect(result.stderr).toContain("public.users");
    });

    it("passes a dump that predates the live migration, without comparing the tables", () => {
      const result = run("check", {
        FAKE_LIVE_HEAD: "20261101120000_next",
        FAKE_LIVE_ROWS: "public._prisma_migrations\t2\npublic.new_table\t5\npublic.users\t100",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("predates migration 20261101120000_next");
      expect(status("check").tablesCompared).toBe(false);
    });

    it.each([
      ["holds no finished migration", ""],
      ["is ahead of the live database", "20270101120000_later"],
    ])("fails a dump that %s", (message, restoredHead) => {
      const result = run("check", { FAKE_RESTORED_HEAD: restoredHead });

      expect(result.status).toBe(1);
      expect(status("check")).toMatchObject({ ok: false, reason: "tables" });
      expect(result.stderr).toContain(message);
    });

    it("fails when a table came back with far fewer rows than the live one", () => {
      const result = run("check", { FAKE_RESTORED_ROWS: "public._prisma_migrations\t1\npublic.users\t10" });

      expect(result.status).toBe(1);
      expect(status("check")).toMatchObject({ ok: false, reason: "rows" });
      expect(result.stderr).toContain("public.users (100 live, 10 restored)");
    });

    it("ignores a small table's difference", () => {
      const result = run("check", {
        FAKE_LIVE_ROWS: "public._prisma_migrations\t10",
        FAKE_RESTORED_ROWS: "public._prisma_migrations\t1",
      });

      expect(result.status).toBe(0);
    });
  });
});
