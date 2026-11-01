import { describe, expect, it } from "vitest";
import type { BackupFile } from "./backup-files.js";
import {
  backupStatus,
  CHECK_MAX_AGE_MS,
  DISK_CRITICAL_PERCENT,
  DISK_WARNING_PERCENT,
  diskVerdict,
  DUMP_MAX_AGE_MS,
  JOB_STUCK_AFTER_MS,
  jobVerdict,
  QUEUE_ERROR_SHOWN_MS,
  queueVerdict,
} from "./system.health.js";

const NOW = new Date("2027-01-15T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function okRun(age: number, extra: object = {}): BackupFile {
  const at = ago(age);
  return { kind: "read", run: { finishedAt: at, ok: true, reason: null, lastOkAt: at, ...extra } };
}

function failedRun(reason: string, lastOkAge: number): BackupFile {
  return { kind: "read", run: { finishedAt: ago(0), ok: false, reason, lastOkAt: ago(lastOkAge) } };
}

describe("the state of the backups (П3)", () => {
  const goodCheck = okRun(DAY_MS);

  it("is green for a fresh dump and shows its size and copies", () => {
    const { dump } = backupStatus(okRun(MINUTE_MS, { dumpBytes: 2048, copies: 12 }), goodCheck, NOW);
    expect(dump).toMatchObject({ state: "good", dumpBytes: 2048, copies: 12 });
  });

  it("stays green right at the limit and turns red past it", () => {
    expect(backupStatus(okRun(DUMP_MAX_AGE_MS), goodCheck, NOW).dump.state).toBe("good");
    const late = backupStatus(okRun(DUMP_MAX_AGE_MS + MINUTE_MS), goodCheck, NOW).dump;
    expect(late).toMatchObject({ state: "critical", label: "Бекап застарів" });
  });

  it("is red after a failed run and says why, though an older one went through", () => {
    const { dump } = backupStatus(failedRun("disk", MINUTE_MS), goodCheck, NOW);
    expect(dump.state).toBe("critical");
    expect(dump.label).toContain("мало місця на диску");
    expect(dump.lastOkAt).toBe(ago(MINUTE_MS));
  });

  it("has an answer for a reason it has not heard of", () => {
    expect(backupStatus(failedRun("new-code", 0), goodCheck, NOW).dump.label).toContain("невідома причина");
  });

  it("is red with its own words when the file is missing or broken", () => {
    expect(backupStatus({ kind: "missing" }, goodCheck, NOW).dump.label).toBe("Бекапи не налаштовані");
    expect(backupStatus({ kind: "broken" }, goodCheck, NOW).dump.label).toBe("Стан бекапів не читається");
  });

  it("is red when the restore check failed, went stale or never ran", () => {
    const dump = okRun(MINUTE_MS);
    expect(backupStatus(dump, failedRun("restore", DAY_MS), NOW).restoreCheck.state).toBe("critical");
    expect(backupStatus(dump, okRun(CHECK_MAX_AGE_MS + MINUTE_MS), NOW).restoreCheck.label).toBe("Перевірка застаріла");
    expect(backupStatus(dump, { kind: "missing" }, NOW).restoreCheck.state).toBe("critical");
  });

  it("is yellow when a dump older than a migration left the tables and the grants unchecked", () => {
    const { restoreCheck } = backupStatus(okRun(MINUTE_MS), okRun(DAY_MS, { tablesCompared: false }), NOW);
    expect(restoreCheck).toMatchObject({ state: "warning", label: "Копія відновилась, таблиці й права не звірені" });
  });

  it("gives the date of the last restore check", () => {
    const { restoreCheck } = backupStatus(okRun(MINUTE_MS), okRun(DAY_MS, { tables: 15 }), NOW);
    expect(restoreCheck).toMatchObject({ state: "good", lastOkAt: ago(DAY_MS), tables: 15 });
  });
});

describe("the state of the disk (П4)", () => {
  it.each([
    [DISK_WARNING_PERCENT - 1, "good"],
    [DISK_WARNING_PERCENT, "warning"],
    [DISK_CRITICAL_PERCENT - 1, "warning"],
    [DISK_CRITICAL_PERCENT, "critical"],
  ])("at %i%% is %s", (percent, state) => {
    expect(diskVerdict(percent).state).toBe(state);
  });

  it("does not pretend to know", () => {
    expect(diskVerdict(null)).toMatchObject({ state: "warning", label: "Стан диска невідомий" });
  });
});

describe("the state of a job (П2)", () => {
  const healthy = {
    registeredAt: new Date(NOW.getTime() - 90 * DAY_MS),
    runningSince: null,
    lastSuccessAt: new Date(NOW.getTime() - 2 * DAY_MS),
    lastFailureAt: null,
    failureStreak: 0,
    skippedItems: 0,
  };
  const limit = 3 * DAY_MS;

  it("is green after a recent success", () => {
    expect(jobVerdict(healthy, limit, NOW).state).toBe("good");
  });

  it("is red after a failure, however recent the last success", () => {
    expect(jobVerdict({ ...healthy, failureStreak: 1 }, limit, NOW).state).toBe("critical");
  });

  it("is red after too long a silence", () => {
    const quiet = { ...healthy, lastSuccessAt: new Date(NOW.getTime() - 4 * DAY_MS) };
    expect(jobVerdict(quiet, limit, NOW)).toMatchObject({ state: "critical", label: "Давно не запускалась" });
  });

  it("waits for a first run, until the wait itself is too long", () => {
    const fresh = { ...healthy, registeredAt: new Date(NOW.getTime() - DAY_MS), lastSuccessAt: null };
    expect(jobVerdict(fresh, limit, NOW).state).toBe("waiting");
    const stale = { ...fresh, registeredAt: new Date(NOW.getTime() - 4 * DAY_MS) };
    expect(jobVerdict(stale, limit, NOW).state).toBe("critical");
  });

  it("is green while a run is on its way, and red once it stays open past the expiry of the queue", () => {
    const started = (age: number) => ({ ...healthy, runningSince: new Date(NOW.getTime() - age) });
    expect(jobVerdict(started(MINUTE_MS), limit, NOW).state).toBe("good");
    expect(jobVerdict(started(JOB_STUCK_AFTER_MS + MINUTE_MS), limit, NOW)).toMatchObject({
      state: "critical",
      label: "Запуск обірвався або завис",
    });
  });

  it("is yellow for a day after a failure that a retry fixed, so a job failing nightly cannot look healthy", () => {
    const failed = (age: number) => ({ ...healthy, lastFailureAt: new Date(NOW.getTime() - age) });
    expect(jobVerdict(failed(MINUTE_MS), limit, NOW)).toMatchObject({
      state: "warning",
      label: "Був збій, повтор вдався",
    });
    expect(jobVerdict(failed(2 * DAY_MS), limit, NOW).state).toBe("good");
  });

  it("is yellow when a run left elements out", () => {
    expect(jobVerdict({ ...healthy, skippedItems: 3 }, limit, NOW).state).toBe("warning");
  });

  it("has no row before the worker registered it", () => {
    expect(jobVerdict(null, limit, NOW).state).toBe("waiting");
  });
});

describe("the state of the queue", () => {
  it("is green with no error", () => {
    expect(queueVerdict(true, null, NOW).state).toBe("good");
  });

  it("is red while its errors are fresh and calms down after", () => {
    const fresh = new Date(NOW.getTime() - MINUTE_MS);
    const old = new Date(NOW.getTime() - QUEUE_ERROR_SHOWN_MS - MINUTE_MS);
    expect(queueVerdict(true, fresh, NOW)).toMatchObject({ state: "critical", label: "Черга повідомляє про помилки" });
    expect(queueVerdict(true, old, NOW).state).toBe("good");
  });

  it("is red when the numbers cannot be read", () => {
    expect(queueVerdict(false, null, NOW)).toMatchObject({ state: "critical", label: "Черги не читаються" });
  });
});
