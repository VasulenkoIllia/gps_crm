import { SYSTEM_STATE, type BackupStatus, type SystemState, type SystemVerdict } from "@gps_crm/shared";
import { JOB_EXPIRE_SECONDS } from "../../core/jobs/job.js";
import type { BackupFile, BackupRun } from "./backup-files.js";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
// П3: a dump every 6 hours with an hour of margin
export const DUMP_MAX_AGE_MS = 7 * HOUR_MS;
// The check runs on the 15th: the longest gap between two is 31 days, with a margin for a deploy that held it up
export const CHECK_MAX_AGE_MS = 35 * DAY_MS;
// П4
export const DISK_WARNING_PERCENT = 80;
export const DISK_CRITICAL_PERCENT = 90;
// A run still open after pg-boss itself gave up on it: the process died, or the job hangs
export const JOB_STUCK_AFTER_MS = (JOB_EXPIRE_SECONDS + 5 * 60) * 1_000;
// A retry that went through must not read as a quiet night: a job failing nightly would look healthy for good
export const RETRIED_FAILURE_SHOWN_MS = DAY_MS;
// The queue reports its own errors many times a minute while something is wrong, and long after a blip nothing is
export const QUEUE_ERROR_SHOWN_MS = 10 * 60 * 1_000;

// The codes of backup.sh in plain words; RESTORE.md has what to do about each
const BACKUP_REASONS: Record<string, string> = {
  lock: "деплой тримав блокування",
  busy: "перевірка вже йде",
  "no-db": "база недоступна",
  disk: "мало місця на диску",
  dump: "дамп не знявся",
  "read-back": "дамп не прочитався",
  "no-dump": "немає дампа для перевірки",
  restore: "дамп не відновився",
  tables: "відновлені таблиці не збігаються",
  rows: "у копії значно менше рядків",
  grants: "права ролі застосунку не збігаються",
  cleanup: "не видалився тимчасовий контейнер",
  live: "не вдалося прочитати живу базу",
};

function reasonText(reason: string | null): string {
  return (reason && BACKUP_REASONS[reason]) ?? "невідома причина";
}

function verdict(state: SystemState, label: string): SystemVerdict {
  return { state, label };
}

function isOlderThan(moment: string | null, maxAgeMs: number, now: Date): boolean {
  return !moment || now.getTime() - new Date(moment).getTime() > maxAgeMs;
}

function dumpVerdict(file: BackupFile, now: Date): SystemVerdict {
  if (file.kind === "missing") return verdict(SYSTEM_STATE.critical, "Бекапи не налаштовані");
  if (file.kind === "broken") return verdict(SYSTEM_STATE.critical, "Стан бекапів не читається");
  const { run } = file;
  if (!run.ok) return verdict(SYSTEM_STATE.critical, `Останній бекап не вдався: ${reasonText(run.reason)}`);
  if (isOlderThan(run.lastOkAt, DUMP_MAX_AGE_MS, now)) return verdict(SYSTEM_STATE.critical, "Бекап застарів");
  return verdict(SYSTEM_STATE.good, "Бекапи в порядку");
}

function checkVerdict(file: BackupFile, now: Date): SystemVerdict {
  if (file.kind === "missing") return verdict(SYSTEM_STATE.critical, "Перевірки відновлення ще не було");
  if (file.kind === "broken") return verdict(SYSTEM_STATE.critical, "Стан перевірки не читається");
  const { run } = file;
  if (!run.ok) return verdict(SYSTEM_STATE.critical, `Перевірка не пройшла: ${reasonText(run.reason)}`);
  if (isOlderThan(run.lastOkAt, CHECK_MAX_AGE_MS, now)) return verdict(SYSTEM_STATE.critical, "Перевірка застаріла");
  if (run.tablesCompared === false)
    return verdict(SYSTEM_STATE.warning, "Копія відновилась, таблиці й права не звірені");
  return verdict(SYSTEM_STATE.good, "Відновлення перевірене");
}

function runOf(file: BackupFile): BackupRun | null {
  return file.kind === "read" ? file.run : null;
}

export function backupStatus(dump: BackupFile, check: BackupFile, now: Date): BackupStatus {
  const dumpRun = runOf(dump);
  const checkRun = runOf(check);
  return {
    dump: {
      ...dumpVerdict(dump, now),
      lastOkAt: dumpRun?.lastOkAt ?? null,
      finishedAt: dumpRun?.finishedAt ?? null,
      dumpBytes: dumpRun?.dumpBytes ?? null,
      copies: dumpRun?.copies ?? null,
    },
    restoreCheck: {
      ...checkVerdict(check, now),
      lastOkAt: checkRun?.lastOkAt ?? null,
      finishedAt: checkRun?.finishedAt ?? null,
      tables: checkRun?.tables ?? null,
    },
  };
}

export function diskVerdict(usedPercent: number | null): SystemVerdict {
  if (usedPercent === null) return verdict(SYSTEM_STATE.warning, "Стан диска невідомий");
  if (usedPercent >= DISK_CRITICAL_PERCENT) return verdict(SYSTEM_STATE.critical, "Диск майже заповнений");
  if (usedPercent >= DISK_WARNING_PERCENT) return verdict(SYSTEM_STATE.warning, "Диск заповнюється");
  return verdict(SYSTEM_STATE.good, "Місця достатньо");
}

export interface JobHealthFacts {
  registeredAt: Date;
  runningSince: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  failureStreak: number;
  skippedItems: number;
}

function hasRetriedFailure(health: JobHealthFacts, now: Date): boolean {
  return Boolean(health.lastFailureAt && now.getTime() - health.lastFailureAt.getTime() < RETRIED_FAILURE_SHOWN_MS);
}

// П2: red when it failed or stayed silent for longer than its schedule with a margin. Skipped elements are yellow: the
// run itself went through.
export function jobVerdict(health: JobHealthFacts | null, maxSilenceMs: number, now: Date): SystemVerdict {
  if (!health) return verdict(SYSTEM_STATE.waiting, "Чекає на першу реєстрацію");
  if (health.failureStreak > 0) return verdict(SYSTEM_STATE.critical, "Останній запуск не вдався");
  if (health.runningSince && now.getTime() - health.runningSince.getTime() > JOB_STUCK_AFTER_MS) {
    return verdict(SYSTEM_STATE.critical, "Запуск обірвався або завис");
  }
  const silentSince = health.lastSuccessAt ?? health.registeredAt;
  if (now.getTime() - silentSince.getTime() > maxSilenceMs) {
    return verdict(SYSTEM_STATE.critical, "Давно не запускалась");
  }
  if (!health.lastSuccessAt) return verdict(SYSTEM_STATE.waiting, "Чекає на перший запуск");
  if (health.skippedItems > 0) return verdict(SYSTEM_STATE.warning, "Є пропущені елементи");
  if (hasRetriedFailure(health, now)) return verdict(SYSTEM_STATE.warning, "Був збій, повтор вдався");
  return verdict(SYSTEM_STATE.good, "Працює");
}

export function queueVerdict(canRead: boolean, lastErrorAt: Date | null, now: Date): SystemVerdict {
  if (!canRead) return verdict(SYSTEM_STATE.critical, "Черги не читаються");
  if (lastErrorAt && now.getTime() - lastErrorAt.getTime() < QUEUE_ERROR_SHOWN_MS) {
    return verdict(SYSTEM_STATE.critical, "Черга повідомляє про помилки");
  }
  return verdict(SYSTEM_STATE.good, "Черга працює");
}
