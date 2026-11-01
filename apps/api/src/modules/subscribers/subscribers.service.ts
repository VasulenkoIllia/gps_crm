import {
  isTariffDateAllowed,
  todayKyiv,
  type CreatedSubscriber,
  type IdSeries,
  type SubscriberCodeInput,
  type SubscriberCreate,
  type SubscriberTariffInput,
  type SubscriberUpdate,
} from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import {
  actorIdOf,
  recordActivities,
  recordActivity,
  type ActivityContext,
} from "../../core/activity/activity.repository.js";
import type { AppConfig } from "../../core/config.js";
import { isUniqueViolation, type DbOrTx } from "../../core/db/client.js";
import type { AppDeps } from "../../core/deps.js";
import { AppError } from "../../core/errors.js";
import { assertVersion, changedFields, hasChanges, selectTariff, type SelectedTariff } from "../references/index.js";
import * as contacts from "./contacts.repository.js";
import * as series from "./id-series.repository.js";
import * as payers from "./payers.repository.js";
import { requireLiveSubscriber } from "./subscribers.helpers.js";
import { findManagerName } from "./subscribers.queries.js";
import * as repo from "./subscribers.repository.js";

// П8
const CODE_ATTEMPTS = 20;
// Fifty people in one series queue on its row: each waits its turn instead of failing on the pool's short default
const CREATE_TRANSACTION = { maxWait: 10_000, timeout: 10_000 };
const MANAGER_TEXT = "Оберіть менеджера";
const UPDATED_FIELDS = ["type", "name", "taxId", "crmUrl", "graceDays", "discountKop", "legacyCode", "note"] as const;

type SubscriberDeps = Pick<AppDeps, "db" | "config">;

// By the parts of the address: a text prefix takes https://crm.company.test@other.example for the CRM
function leadsTo(url: string, crmUrl: string): boolean {
  const target = URL.parse(url);
  const crm = new URL(crmUrl);
  return target?.origin === crm.origin && target.pathname.startsWith(crm.pathname);
}

// П13
function assertCrmAddress(config: AppConfig, url: string): void {
  if (!config.crmUrl || leadsTo(url, config.crmUrl)) return;
  const message = `Посилання має вести на ${config.crmUrl}`;
  throw new AppError(422, "crm_url_foreign", message, { crmUrl: message });
}

async function requireManager(tx: DbOrTx, id: string): Promise<string> {
  const name = await findManagerName(tx, id);
  if (name === null) throw new AppError(422, "manager_unavailable", MANAGER_TEXT, { managerId: MANAGER_TEXT });
  return name;
}

// A name only for a client this person may see: the level `own` must not read the base through a check
function nameFor(scope: RecordScope, holder: { name: string } | null): string | null {
  return scope.managerId ? null : (holder?.name ?? null);
}

function legacyTaken(holderName: string | null): AppError {
  const message = holderName
    ? `Цей старий номер уже має клієнт «${holderName}»`
    : "Цей старий номер уже має інший клієнт";
  return new AppError(409, "legacy_code_taken", message, { legacyCode: message });
}

function codeTaken(holderName: string | null): AppError {
  const message = holderName ? `ID уже використовує клієнт «${holderName}»` : "ID уже використовує інший клієнт";
  return new AppError(409, "code_taken", message, { code: message });
}

function seriesProblem(message: string): AppError {
  return new AppError(409, "series_unavailable", message);
}

async function assertLegacyFree(tx: DbOrTx, scope: RecordScope, legacyCode: string | null): Promise<void> {
  if (!legacyCode) return;
  const holder = await repo.findLegacyHolder(tx, legacyCode);
  if (holder) throw legacyTaken(nameFor(scope, holder));
}

// Under the row lock of the series. A skipped number stays behind for good: only a person sets the counter back.
async function issueCode(
  tx: DbOrTx,
  scope: RecordScope,
  idSeries: IdSeries,
  input: repo.NewSubscriber,
): Promise<CreatedSubscriber> {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = idSeries.nextNumber + attempt;
    if (code > idSeries.rangeTo) {
      throw seriesProblem(`Серія «${idSeries.name}» вичерпана. Розширте її на екрані «Серії ID»`);
    }
    const id = await repo.insertSubscriber(tx, input, code);
    if (id) {
      await series.advanceSeries(tx, idSeries.id, code + 1);
      return { id, code };
    }
    if (input.legacyCode && !(await repo.findCodeHolder(tx, code))) {
      throw legacyTaken(nameFor(scope, await repo.findLegacyHolder(tx, input.legacyCode)));
    }
  }
  throw seriesProblem(`У серії «${idSeries.name}» ${CODE_ATTEMPTS} номерів підряд зайняті. Змініть наступний номер`);
}

function tariffLabel(tariff: SelectedTariff): string {
  return `${tariff.name} (${tariff.serverName})`;
}

interface CreatedParts {
  subscriber: CreatedSubscriber;
  contactId: string;
  payerId: string;
  seriesName: string;
  tariff: SelectedTariff;
  managerName: string;
}

function recordCreated(tx: DbOrTx, context: ActivityContext, input: SubscriberCreate, parts: CreatedParts) {
  const { subscriber, contactId, payerId, seriesName, tariff, managerName } = parts;
  const shared = { subscriberId: subscriber.id };
  return recordActivities(tx, context, [
    {
      ...shared,
      action: "subscriber.created",
      entityType: "subscriber",
      entityId: subscriber.id,
      details: {
        label: input.name,
        code: subscriber.code,
        series: seriesName,
        manager: managerName,
        tariff: tariffLabel(tariff),
        validFrom: input.tariffValidFrom,
      },
    },
    {
      ...shared,
      action: "contact.created",
      entityType: "contact",
      entityId: contactId,
      details: { label: input.contact.fullName },
    },
    {
      ...shared,
      action: "payer.created",
      entityType: "payer",
      entityId: payerId,
      details: { label: input.name, paymentMethod: input.payer.paymentMethod },
    },
  ]);
}

async function createFirstContact(tx: DbOrTx, id: string, input: SubscriberCreate, createdBy: string | null) {
  return contacts.createContact(
    tx,
    id,
    {
      ...input.contact,
      crmUrl: input.crmUrl,
      isPrimary: true,
      billingNotify: true,
      techNotify: true,
      isActive: true,
    },
    createdBy,
  );
}

// payers.md П2: the most frequent case, the client pays for itself
async function createFirstPayer(tx: DbOrTx, id: string, input: SubscriberCreate, createdBy: string | null) {
  const payerId = await payers.createPayer(tx, { ...input.payer, name: input.name, taxId: input.taxId }, createdBy);
  await payers.linkPayer(tx, payerId, id, createdBy);
  return payerId;
}

function newSubscriberOf(input: SubscriberCreate, managerId: string, createdBy: string | null): repo.NewSubscriber {
  const { type, name, crmUrl, graceDays, discountKop, legacyCode, note, programId, tariffId } = input;
  return {
    type,
    name,
    taxId: input.taxId ?? null,
    crmUrl,
    managerId,
    graceDays,
    discountKop,
    legacyCode,
    note,
    programId,
    tariffId,
    createdBy,
  };
}

export function createSubscriber(
  deps: SubscriberDeps,
  context: ActivityContext,
  scope: RecordScope,
  input: SubscriberCreate,
): Promise<CreatedSubscriber> {
  assertCrmAddress(deps.config, input.crmUrl);
  const actorId = actorIdOf(context);
  const managerId = scope.managerId ?? input.managerId ?? actorId;
  if (!managerId) throw new AppError(422, "manager_unavailable", MANAGER_TEXT, { managerId: MANAGER_TEXT });
  return deps.db.$transaction(async (tx) => {
    // The tariff before the series, always: two creations then never hold them the other way round
    const tariff = await selectTariff(tx, input.programId, input.tariffId);
    const managerName = await requireManager(tx, managerId);
    await assertLegacyFree(tx, scope, input.legacyCode);
    const idSeries = await series.lockSeriesOfType(tx, input.type);
    if (!idSeries) throw seriesProblem(`Тип ${input.type} не має серії. Призначте її на екрані «Серії ID»`);
    const subscriber = await issueCode(tx, scope, idSeries, newSubscriberOf(input, managerId, actorId));
    await repo.openTariffPeriod(tx, subscriber.id, tariff.id, input.tariffValidFrom, actorId);
    const contactId = await createFirstContact(tx, subscriber.id, input, actorId);
    const payerId = await createFirstPayer(tx, subscriber.id, input, actorId);
    const parts = { subscriber, contactId, payerId, seriesName: idSeries.name, tariff, managerName };
    await recordCreated(tx, context, input, parts);
    return subscriber;
  }, CREATE_TRANSACTION);
}

export async function updateSubscriber(
  deps: SubscriberDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: SubscriberUpdate,
): Promise<void> {
  assertCrmAddress(deps.config, input.crmUrl);
  await deps.db
    .$transaction(async (tx) => {
      const before = await requireLiveSubscriber(tx, id, scope);
      assertVersion(before, input.version);
      const isNewManager = before.managerId !== input.managerId;
      const manager = isNewManager ? await requireManager(tx, input.managerId) : before.managerName;
      const changes = {
        ...changedFields(before, input, [...UPDATED_FIELDS]),
        ...(isNewManager ? { manager: [before.managerName, manager] as [string, string] } : {}),
      };
      if (!hasChanges(changes)) return;
      await repo.updateSubscriber(tx, id, input, actorIdOf(context));
      await recordActivity(tx, context, {
        action: "subscriber.updated",
        entityType: "subscriber",
        entityId: id,
        subscriberId: id,
        details: { label: input.name },
        changes,
      });
    })
    .catch(async (error: unknown) => {
      // The only unique column this write touches
      if (!isUniqueViolation(error) || !input.legacyCode) throw error;
      throw legacyTaken(nameFor(scope, await repo.findLegacyHolder(deps.db, input.legacyCode)));
    });
}

export async function changeSubscriberCode(
  deps: SubscriberDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: SubscriberCodeInput,
): Promise<void> {
  await deps.db
    .$transaction(async (tx) => {
      const before = await requireLiveSubscriber(tx, id, scope);
      assertVersion(before, input.version);
      if (before.code === input.code) return;
      await repo.updateCode(tx, id, input.code, actorIdOf(context));
      await recordActivity(tx, context, {
        action: "subscriber.code_changed",
        entityType: "subscriber",
        entityId: id,
        subscriberId: id,
        details: { label: before.name },
        changes: { code: [before.code, input.code] },
      });
    })
    .catch(async (error: unknown) => {
      if (!isUniqueViolation(error)) throw error;
      throw codeTaken(nameFor(scope, await repo.findCodeHolder(deps.db, input.code)));
    });
}

function dateText(date: string): string {
  return date.split("-").reverse().join(".");
}

// П25, П27. A past version stays as it was: a new one goes on top of what has not begun yet, or replaces the one of the
// same date. That one, and one that never began, closes on its own start: an empty period that overlaps nothing.
async function rewritePeriods(tx: DbOrTx, subscriberId: string, validFrom: string, today: string): Promise<void> {
  const periods = await repo.findTariffPeriods(tx, subscriberId);
  const live = periods.filter((period) => period.validTo === null || period.validTo > period.validFrom);
  const newer = live.find((period) => period.validFrom > validFrom && period.validFrom <= today);
  if (newer) {
    const message = `Вже є версія тарифу від ${dateText(newer.validFrom)}: нова дата має бути не раніше`;
    throw new AppError(409, "tariff_date_overlap", message, { validFrom: message });
  }
  for (const period of live) {
    if (period.validFrom >= validFrom) await repo.closeTariffPeriod(tx, period.id, period.validFrom);
    else if (period.validTo === null || period.validTo > validFrom) {
      await repo.closeTariffPeriod(tx, period.id, validFrom);
    }
  }
}

export async function changeSubscriberTariff(
  deps: SubscriberDeps,
  context: ActivityContext,
  scope: RecordScope,
  id: string,
  input: SubscriberTariffInput,
): Promise<void> {
  const today = todayKyiv();
  await deps.db.$transaction(async (tx) => {
    const before = await requireLiveSubscriber(tx, id, scope);
    // The schema has checked it too, against the moment the request was parsed
    if (!isTariffDateAllowed(input.validFrom, today)) throw new AppError(400, "validation_failed", "Некоректна дата");
    const tariff = await selectTariff(tx, input.programId, input.tariffId);
    const actorId = actorIdOf(context);
    await rewritePeriods(tx, id, input.validFrom, today);
    await repo.openTariffPeriod(tx, id, tariff.id, input.validFrom, actorId);
    await repo.mirrorTariff(tx, id, { programId: tariff.programId, tariffId: tariff.id }, actorId);
    await recordActivity(tx, context, {
      action: "subscriber.tariff_changed",
      entityType: "subscriber",
      entityId: id,
      subscriberId: id,
      details: { label: before.name, validFrom: input.validFrom },
      changes: { tariff: [before.tariffName, tariffLabel(tariff)] },
    });
  });
}
