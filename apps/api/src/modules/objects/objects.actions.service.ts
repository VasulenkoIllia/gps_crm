import {
  dateText,
  isLivePeriod,
  nextObjectStatuses,
  OBJECT_STATUS_META,
  periodOn,
  planVersion,
  todayKyiv,
  type ObjectAddonChange,
  type ObjectStatusChange,
  type ObjectTermsChange,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import { actorIdOf, recordActivity, type ActivityContext } from "../../core/activity/activity.repository.js";
import type { DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { requireActive, selectTariff } from "../references/index.js";
import { lockClientPayer, refreshRollup, requireClientPayer } from "../subscribers/index.js";
import { findTariffOn } from "./objects.card.queries.js";
import { lockLiveObject, lockWorkingObject, objectEvent } from "./objects.helpers.js";
import {
  findAddonName,
  findClientTariffId,
  findPayerName,
  findTariffFact,
  type TariffFact,
} from "./objects.queries.js";
import * as repo from "./objects.repository.js";
import { requireAddonOfProgram } from "./objects.service.js";

type ObjectDeps = Pick<AppDeps, "db">;

const REASON_TEXT = "Вкажіть причину відключення";
const DISCONNECT_DATE_TEXT = "Дата відключення раніше дати підключення";

function dateRefused(code: string, field: string, message: string): AppError {
  return new AppError(409, code, message, { [field]: message });
}

function assertTransition(object: repo.ObjectRow, input: ObjectStatusChange): void {
  if (object.status === input.status) {
    throw new AppError(409, "status_unchanged", `Об'єкт уже ${OBJECT_STATUS_META[object.status].label.toLowerCase()}`);
  }
  if (!nextObjectStatuses(object.status).includes(input.status)) {
    throw new AppError(409, "status_refused", "Такої зміни статусу немає");
  }
  if (input.validFrom < object.statusFrom) {
    const message = `Поточний статус діє з ${dateText(object.statusFrom)}: нова дата має бути не раніше`;
    throw dateRefused("status_date_overlap", "validFrom", message);
  }
  if (input.status === "disconnected" && input.validFrom < object.connectedOn) {
    throw dateRefused("status_date_overlap", "validFrom", DISCONNECT_DATE_TEXT);
  }
}

// D71: an object out of the archive has no tracker, and a payer may have left the client while it stood disconnected.
// Both have a way out: a tracker goes on through a replacement, a payer is linked back.
async function assertCanReconnect(tx: DbOrTx, object: repo.ObjectRow): Promise<void> {
  if (!object.currentDeviceId) {
    throw new AppError(409, "object_without_tracker", "На об'єкті немає трекера: спершу встановіть його");
  }
  if (await lockClientPayer(tx, object.subscriberId, object.payerId)) return;
  const name = await findPayerName(tx, object.payerId);
  const message = `Платник «${name}» більше не працює з цим клієнтом: спершу відновіть або прив'яжіть його`;
  throw new AppError(409, "payer_unavailable", message);
}

export async function changeObjectStatus(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ObjectStatusChange,
): Promise<void> {
  const actorId = actorIdOf(context);
  await deps.db.$transaction(async (tx) => {
    const object = await lockLiveObject(tx, id, scope);
    assertTransition(object, input);
    const reasonId = input.reasonId ?? null;
    const reason = reasonId ? await requireActive(tx, "disconnect-reasons", reasonId, "reasonId", REASON_TEXT) : null;
    if (object.status === "disconnected") await assertCanReconnect(tx, object);
    const period = { status: input.status, validFrom: input.validFrom, reasonId, note: input.note, createdBy: actorId };
    await repo.closeStatusPeriod(tx, id, input.validFrom);
    await repo.openStatusPeriod(tx, id, period);
    await repo.mirrorStatus(tx, id, period, actorId);
    await refreshRollup(tx, object.subscriberId);
    await recordActivity(
      tx,
      context,
      objectEvent("object.status_changed", object, {
        details: { validFrom: input.validFrom, ...(reason ? { reason: reason.name } : {}) },
        changes: { status: [object.status, input.status] },
      }),
    );
  });
}

function assertTermsDate(terms: repo.TermRow[], validFrom: string, today: string) {
  const plan = planVersion(terms, validFrom, today);
  if (!plan.blockedBy) return plan;
  const message = `Вже є версія умов від ${dateText(plan.blockedBy.validFrom)}: нова дата має бути не раніше`;
  throw dateRefused("terms_date_overlap", "validFrom", message);
}

// П19: a payer changes from a date, and a tariff planned ahead stays planned: it just goes under the new payer
async function writePayerVersion(
  tx: DbOrTx,
  id: string,
  terms: repo.TermRow[],
  input: ObjectTermsChange,
  payerId: string,
  { today, actorId }: { today: string; actorId: string | null },
): Promise<void> {
  const planned = terms.filter((term) => isLivePeriod(term) && term.validFrom > input.validFrom);
  const { closings } = assertTermsDate(terms, input.validFrom, today);
  const inForce = periodOn(terms, input.validFrom);
  for (const { id: termId, validTo } of closings) {
    if (!planned.some((term) => term.id === termId)) await repo.closeTerm(tx, termId, validTo);
  }
  await repo.openTerm(tx, id, {
    payerId,
    ownTariffId: inForce?.ownTariffId ?? null,
    validFrom: input.validFrom,
    validTo: planned.at(-1)?.validFrom ?? null,
    createdBy: actorId,
  });
  for (const term of planned) await repo.setTermPayer(tx, term.id, payerId);
}

// П18: a new tariff, or the one of the client back. The rule of the versions is the one of a client's tariff (D61)
async function writeTariffVersion(
  tx: DbOrTx,
  id: string,
  terms: repo.TermRow[],
  input: ObjectTermsChange,
  payerId: string,
  { today, actorId }: { today: string; actorId: string | null },
): Promise<void> {
  const { closings } = assertTermsDate(terms, input.validFrom, today);
  const ownTariffId = input.ownTariff ? input.ownTariff.tariffId : null;
  for (const { id: termId, validTo } of closings) await repo.closeTerm(tx, termId, validTo);
  await repo.openTerm(tx, id, { payerId, ownTariffId, validFrom: input.validFrom, validTo: null, createdBy: actorId });
}

async function mirrorOpenTerm(tx: DbOrTx, object: repo.ObjectRow, actorId: string | null): Promise<TariffFact> {
  const [open] = (await repo.findTerms(tx, object.id)).filter((term) => term.validTo === null);
  if (!open) throw new AppError(409, "terms_missing", "Об'єкт не має чинних умов");
  const tariffId = open.ownTariffId ?? (await findClientTariffId(tx, object.subscriberId));
  const tariff = await findTariffFact(tx, tariffId);
  const { programId, serverId } = tariff;
  const mirror = { payerId: open.payerId, tariffId, programId, serverId, hasOwnTariff: open.ownTariffId !== null };
  await repo.mirrorTerms(tx, object.id, mirror, actorId);
  return tariff;
}

async function termsChanges(
  tx: DbOrTx,
  object: repo.ObjectRow,
  before: TariffFact,
  after: TariffFact,
  payerId: string,
) {
  const label = (tariff: TariffFact) => `${tariff.tariffName} (${tariff.serverName})`;
  return {
    ...(before.tariffId === after.tariffId ? {} : { tariff: [label(before), label(after)] as [string, string] }),
    ...(object.payerId === payerId
      ? {}
      : { payer: [await findPayerName(tx, object.payerId), await findPayerName(tx, payerId)] as [string, string] }),
  };
}

export async function changeObjectTerms(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ObjectTermsChange,
): Promise<void> {
  const today = todayKyiv();
  const actorId = actorIdOf(context);
  await deps.db.$transaction(async (tx) => {
    const object = await lockWorkingObject(tx, id, scope);
    const payerId = input.payerId ?? object.payerId;
    if (input.payerId) await requireClientPayer(tx, object.subscriberId, input.payerId);
    if (input.ownTariff) await selectTariff(tx, input.ownTariff.programId, input.ownTariff.tariffId);
    const before = await findTariffFact(tx, object.tariffId);
    const terms = await repo.findTerms(tx, id);
    const write = input.ownTariff === undefined ? writePayerVersion : writeTariffVersion;
    await write(tx, id, terms, input, payerId, { today, actorId });
    const after = await mirrorOpenTerm(tx, object, actorId);
    await recordActivity(
      tx,
      context,
      objectEvent("object.terms_changed", object, {
        details: { validFrom: input.validFrom },
        changes: await termsChanges(tx, object, before, after, payerId),
      }),
    );
  });
}

async function connectAddon(
  tx: DbOrTx,
  object: repo.ObjectRow,
  input: ObjectAddonChange,
  periods: repo.AddonPeriod[],
  actorId: string | null,
): Promise<string> {
  const name = await requireAddonOfProgram(tx, input.addonId, await findTariffOn(tx, object, input.date), "addonId");
  const [last] = periods.filter(isLivePeriod);
  if (last && last.validTo === null) throw dateRefused("addon_connected", "addonId", "Цю послугу вже підключено");
  if (last?.validTo && input.date < last.validTo) {
    const message = `Послуга діяла до ${dateText(last.validTo)}: дата має бути не раніше`;
    throw dateRefused("addon_date_overlap", "date", message);
  }
  await repo.openAddon(tx, object.id, input.addonId, input.date, actorId);
  return name;
}

async function disconnectAddon(tx: DbOrTx, input: ObjectAddonChange, periods: repo.AddonPeriod[]): Promise<string> {
  const open = periods.find((period) => period.validTo === null);
  if (!open) throw dateRefused("addon_not_connected", "addonId", "Цю послугу не підключено");
  if (input.date < open.validFrom) {
    const message = `Послуга діє з ${dateText(open.validFrom)}: дата має бути не раніше`;
    throw dateRefused("addon_date_overlap", "date", message);
  }
  await repo.closeAddon(tx, open.id, input.date);
  return findAddonName(tx, input.addonId);
}

export async function changeObjectAddons(
  deps: ObjectDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: ObjectAddonChange,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const object = await lockWorkingObject(tx, id, scope);
    const periods = await repo.findAddonPeriods(tx, id, input.addonId);
    const addon =
      input.action === "connect"
        ? await connectAddon(tx, object, input, periods, actorIdOf(context))
        : await disconnectAddon(tx, input, periods);
    const dateField = input.action === "connect" ? "validFrom" : "validTo";
    await recordActivity(
      tx,
      context,
      objectEvent("object.addons_changed", object, { details: { addon, [dateField]: input.date } }),
    );
  });
}
