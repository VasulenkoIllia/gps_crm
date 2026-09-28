// Demo state: mock data + UI settings persisted in localStorage, with the actions the demo screens need.
// In the real product this layer is replaced by API calls; the action signatures mirror future endpoints.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import dayjs, { type Dayjs } from "dayjs";
import type {
  AuditEntry, Contact, GpsObject, Mailing, MessageTemplate, ObjectStatus, Payment, PaymentMethod,
  RoleId, Subscriber, SubscriberStatus, SubscriberType, User,
} from "../domain/types";
import { DATA_VERSION, generateDemoData, type DemoData } from "../data/seed";
import { DEFAULT_ROLE_MATRIX, type Permission, type RoleMatrix } from "../domain/permissions";
import { deriveSubscriberStatus, extendPaidUntil, objectDebt, objectPrice } from "../domain/billing";
import { REASON_BY_ID, TARIFF_BY_ID, USER_BY_ID, USERS, tariffLabel, ADDON_BY_ID } from "../data/reference";

const DATA_KEY = "gps_crm:data";
const UI_KEY = "gps_crm:ui";

export interface UiState {
  role: RoleId;
  userId: string;
  showQuestions: boolean;
  matrix: RoleMatrix;
}

const DEFAULT_UI: UiState = { role: "admin", userId: "u-admin", showQuestions: true, matrix: DEFAULT_ROLE_MATRIX };

export interface SubscriberSummary {
  status: SubscriberStatus;
  total: number;
  active: number;
  suspended: number;
  disconnected: number;
  mrr: number;
  debt: number;
  ltv: number;
  programIds: string[];
}

export interface NewSubscriberInput {
  type: SubscriberType;
  name: string;
  taxId?: string;
  crmUrl: string;
  managerId: string;
  paymentMethod: PaymentMethod;
  note?: string;
  contact: Pick<Contact, "fullName" | "position" | "phone" | "email" | "telegramChatId" | "viberChatId" | "channel">;
}

export interface NewPaymentInput {
  subscriberId: string;
  payerId: string;
  objectIds: string[];
  months: number;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  invoiceNo?: string;
}

function readJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode) — the demo keeps working in memory.
  }
}

function loadData(today: Dayjs): DemoData {
  const stored = readJson<DemoData>(DATA_KEY);
  return stored && stored.version === DATA_VERSION ? stored : generateDemoData(today);
}

function useStoreValue() {
  const today = useMemo(() => dayjs().startOf("day"), []);
  const [data, setData] = useState<DemoData>(() => loadData(today));
  const [ui, setUiState] = useState<UiState>(() => ({ ...DEFAULT_UI, ...readJson<UiState>(UI_KEY) }));

  useEffect(() => writeJson(DATA_KEY, data), [data]);
  useEffect(() => writeJson(UI_KEY, ui), [ui]);

  const setUi = useCallback((patch: Partial<UiState>) => setUiState((u) => ({ ...u, ...patch })), []);
  const setRole = useCallback((role: RoleId) => {
    const user = USERS.find((u) => u.role === role) ?? USERS[0];
    setUiState((u) => ({ ...u, role, userId: user.id }));
  }, []);

  const currentUser: User = USER_BY_ID[ui.userId] ?? USERS[0];
  const can = useCallback((p: Permission) => ui.matrix[ui.role]?.includes(p) ?? false, [ui.matrix, ui.role]);

  const index = useMemo(() => buildIndex(data, today), [data, today]);

  const isVisible = useCallback(
    (sub: Subscriber) => can("subscribers.all") || sub.managerId === currentUser.id,
    [can, currentUser.id],
  );

  const actions = useMemo(() => createActions(setData, today, () => currentUser.id), [today, currentUser.id]);

  const reset = useCallback(() => {
    setData(generateDemoData(today));
    setUiState(DEFAULT_UI);
  }, [today]);

  return { data, today, ui, setUi, setRole, currentUser, can, index, isVisible, actions, reset };
}

export type Store = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<Store | null>(null);

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside DemoStoreProvider");
  return ctx;
}

// ---------- Derived index ----------

function groupBy<T>(list: T[], key: (x: T) => string | undefined) {
  const out: Record<string, T[]> = {};
  for (const x of list) {
    const k = key(x);
    if (k === undefined) continue;
    (out[k] ??= []).push(x);
  }
  return out;
}

export type Index = ReturnType<typeof buildIndex>;

function buildIndex(data: DemoData, today: Dayjs) {
  const subscriberById = Object.fromEntries(data.subscribers.map((s) => [s.id, s]));
  const objectById = Object.fromEntries(data.objects.map((o) => [o.id, o]));
  const payerById = Object.fromEntries(data.payers.map((p) => [p.id, p]));
  const deviceById = Object.fromEntries(data.devices.map((d) => [d.id, d]));
  const simById = Object.fromEntries(data.sims.map((s) => [s.id, s]));
  const templateById = Object.fromEntries(data.templates.map((t) => [t.id, t]));
  const objectsBySubscriber = groupBy(data.objects, (o) => o.subscriberId);
  const contactsBySubscriber = groupBy(data.contacts, (c) => c.subscriberId);
  const payersBySubscriber = groupBy(data.payers, (p) => p.subscriberId);
  const contractsBySubscriber = groupBy(data.contracts, (c) => c.subscriberId);
  const paymentsBySubscriber = groupBy(data.payments, (p) => p.subscriberId);
  const auditBySubscriber = groupBy(data.audit, (a) => a.subscriberId);
  const auditByObject = groupBy(data.audit.filter((a) => a.entity === "object"), (a) => a.entityId);
  const sensorsByObject = groupBy(data.sensors, (s) => s.objectId);

  const summaries: Record<string, SubscriberSummary> = {};
  for (const sub of data.subscribers) {
    const objs = objectsBySubscriber[sub.id] ?? [];
    const live = objs.filter((o) => o.status !== "disconnected");
    summaries[sub.id] = {
      status: deriveSubscriberStatus(objs.map((o) => o.status)),
      total: objs.length,
      active: objs.filter((o) => o.status === "active").length,
      suspended: objs.filter((o) => o.status === "suspended").length,
      disconnected: objs.filter((o) => o.status === "disconnected").length,
      mrr: live.filter((o) => o.status === "active").reduce((s, o) => s + objectPrice(o).total, 0),
      debt: live.reduce((s, o) => s + objectDebt(o, today), 0),
      ltv: (paymentsBySubscriber[sub.id] ?? []).reduce((s, p) => s + p.amount, 0),
      programIds: [...new Set(objs.map((o) => o.programId))],
    };
  }

  return {
    subscriberById, objectById, payerById, deviceById, simById, templateById,
    objectsBySubscriber, contactsBySubscriber, payersBySubscriber, contractsBySubscriber,
    paymentsBySubscriber, auditBySubscriber, auditByObject, sensorsByObject, summaries,
  };
}

// ---------- Actions ----------

type SetData = (fn: (d: DemoData) => DemoData) => void;

function createActions(setData: SetData, today: Dayjs, userId: () => string) {
  const nowIso = () => new Date().toISOString();
  const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const entry = (e: Omit<AuditEntry, "id" | "at" | "userId">): AuditEntry => ({ id: newId("a"), at: nowIso(), userId: userId(), ...e });

  return {
    addSubscriber(input: NewSubscriberInput): string {
      const id = newId("s");
      setData((d) => {
        const n = d.seq.subscriber + 1;
        const code = `AB-${String(n).padStart(5, "0")}`;
        const sub: Subscriber = {
          id, code, type: input.type, name: input.name, taxId: input.taxId || undefined, crmUrl: input.crmUrl,
          managerId: input.managerId, createdAt: today.format("YYYY-MM-DD"), note: input.note,
        };
        const contact: Contact = {
          id: newId("c"), subscriberId: id, ...input.contact, isPrimary: true, billingNotify: true, techNotify: true,
          active: true, crmUrl: input.crmUrl,
        };
        return {
          ...d,
          seq: { ...d.seq, subscriber: n },
          subscribers: [...d.subscribers, sub],
          contacts: [...d.contacts, contact],
          payers: [...d.payers, { id: newId("p"), subscriberId: id, name: input.name, taxId: input.taxId, method: input.paymentMethod }],
          audit: [entry({ entity: "subscriber", entityId: id, subscriberId: id, action: "Створено абонента", details: `${code} · ${input.name}` }), ...d.audit],
        };
      });
      return id;
    },

    addContact(subscriberId: string, c: Omit<Contact, "id" | "subscriberId">) {
      setData((d) => {
        const contact: Contact = { id: newId("c"), subscriberId, ...c };
        const contacts = c.isPrimary
          ? d.contacts.map((x) => (x.subscriberId === subscriberId ? { ...x, isPrimary: false } : x))
          : d.contacts;
        return {
          ...d,
          contacts: [...contacts, contact],
          audit: [entry({ entity: "contact", entityId: contact.id, subscriberId, action: "Додано контактну особу", details: c.fullName }), ...d.audit],
        };
      });
    },

    addPayment(input: NewPaymentInput) {
      setData((d) => {
        const objs = d.objects.filter((o) => input.objectIds.includes(o.id));
        const from = objs.map((o) => dayjs(o.paidUntil).add(1, "day").format("YYYY-MM-DD")).sort()[0] ?? today.format("YYYY-MM-DD");
        const updates = new Map<string, GpsObject>();
        const log: AuditEntry[] = [];
        for (const o of objs) {
          const paidUntil = extendPaidUntil(o.paidUntil, input.months);
          const reactivate = o.status === "suspended" && !dayjs(paidUntil).isBefore(today);
          updates.set(o.id, { ...o, paidUntil, status: reactivate ? "active" : o.status });
          if (reactivate) {
            log.push(entry({ entity: "object", entityId: o.id, subscriberId: o.subscriberId, action: "Відновлено після оплати", details: o.name }));
          }
        }
        const to = [...updates.values()].map((o) => o.paidUntil).sort().at(-1) ?? from;
        const payment: Payment = {
          id: newId("y"), subscriberId: input.subscriberId, payerId: input.payerId, invoiceNo: input.invoiceNo || undefined,
          amount: input.amount, paidAt: input.paidAt, periodFrom: from, periodTo: to, objectIds: input.objectIds,
          method: input.method, createdBy: userId(),
        };
        log.unshift(entry({
          entity: "payment", entityId: payment.id, subscriberId: input.subscriberId, action: "Внесено оплату",
          details: `${input.amount.toLocaleString("uk-UA")} грн · ${objs.length} об'єкт(ів) · ${input.months} міс.`,
        }));
        return {
          ...d,
          objects: d.objects.map((o) => updates.get(o.id) ?? o),
          payments: [...d.payments, payment],
          audit: [...log.reverse(), ...d.audit],
        };
      });
    },

    setObjectStatus(objectId: string, status: ObjectStatus, reasonId?: string) {
      setData((d) => {
        const o = d.objects.find((x) => x.id === objectId);
        if (!o) return d;
        const disconnected = status === "disconnected";
        const next: GpsObject = {
          ...o,
          status,
          disconnectedAt: disconnected ? today.format("YYYY-MM-DD") : undefined,
          disconnectReasonId: disconnected ? reasonId : undefined,
        };
        const labels: Record<ObjectStatus, string> = { active: "Активовано об'єкт", suspended: "Призупинено об'єкт", disconnected: "Відключено об'єкт" };
        return {
          ...d,
          objects: d.objects.map((x) => (x.id === objectId ? next : x)),
          sims: d.sims.map((s) => (s.id === o.simId ? { ...s, status: disconnected ? "blocked" : "active" } : s)),
          devices: d.devices.map((dev) => (dev.id === o.deviceId ? { ...dev, status: disconnected ? "dismantled" : "installed" } : dev)),
          audit: [
            entry({
              entity: "object", entityId: objectId, subscriberId: o.subscriberId, action: labels[status],
              details: disconnected ? `${o.name} · причина: ${REASON_BY_ID[reasonId ?? ""]?.name ?? "—"}` : o.name,
            }),
            ...d.audit,
          ],
        };
      });
    },

    updateObject(objectId: string, patch: Pick<GpsObject, "tariffId" | "addonIds" | "discount" | "payerId">) {
      setData((d) => {
        const o = d.objects.find((x) => x.id === objectId);
        if (!o) return d;
        const changes: string[] = [];
        if (patch.tariffId !== o.tariffId) changes.push(`тариф: ${tariffLabel(o.tariffId)} → ${tariffLabel(patch.tariffId)}`);
        if (patch.addonIds.join() !== o.addonIds.join()) {
          changes.push(`послуги: ${patch.addonIds.map((id) => ADDON_BY_ID[id]?.name).join(", ") || "немає"}`);
        }
        if (patch.discount !== o.discount) changes.push(`знижка: ${o.discount} → ${patch.discount} грн`);
        if (patch.payerId !== o.payerId) changes.push("змінено платника");
        const programId = TARIFF_BY_ID[patch.tariffId]?.programId ?? o.programId;
        return {
          ...d,
          objects: d.objects.map((x) => (x.id === objectId ? { ...x, ...patch, programId } : x)),
          audit: changes.length
            ? [entry({ entity: "object", entityId: objectId, subscriberId: o.subscriberId, action: "Змінено умови обслуговування", details: changes.join("; ") }), ...d.audit]
            : d.audit,
        };
      });
    },

    replaceDevice(objectId: string, newDeviceId: string, oldDeviceStatus: "repair" | "in_stock") {
      setData((d) => {
        const o = d.objects.find((x) => x.id === objectId);
        const newDev = d.devices.find((x) => x.id === newDeviceId);
        if (!o || !newDev) return d;
        const oldDev = d.devices.find((x) => x.id === o.deviceId);
        return {
          ...d,
          objects: d.objects.map((x) => (x.id === objectId ? { ...x, deviceId: newDeviceId } : x)),
          devices: d.devices.map((dev) => {
            if (dev.id === newDeviceId) return { ...dev, status: "installed", objectId };
            if (oldDev && dev.id === oldDev.id) return { ...dev, status: oldDeviceStatus, objectId: undefined };
            return dev;
          }),
          sims: d.sims.map((s) => (s.id === o.simId ? { ...s, deviceId: newDeviceId } : s)),
          audit: [
            entry({
              entity: "object", entityId: objectId, subscriberId: o.subscriberId, action: "Замінено трекер",
              details: `IMEI ${oldDev?.imei ?? "—"} → ${newDev.imei}`,
            }),
            ...d.audit,
          ],
        };
      });
    },

    saveTemplate(t: MessageTemplate) {
      setData((d) => ({
        ...d,
        templates: d.templates.some((x) => x.id === t.id) ? d.templates.map((x) => (x.id === t.id ? t : x)) : [...d.templates, t],
      }));
    },

    newTemplateId: () => newId("t"),

    toggleRule(ruleId: string, enabled: boolean) {
      setData((d) => ({ ...d, rules: d.rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r)) }));
    },

    sendMailing(m: Omit<Mailing, "id" | "createdAt" | "userId">) {
      setData((d) => {
        const mailing: Mailing = { id: newId("ml"), createdAt: nowIso(), userId: userId(), ...m };
        return {
          ...d,
          mailings: [mailing, ...d.mailings],
          audit: [entry({ entity: "mailing", entityId: mailing.id, action: "Запущено розсилку", details: m.audience }), ...d.audit],
        };
      });
    },
  };
}
