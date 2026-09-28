// Deterministic mock data generator for the client demo. All names, codes and numbers are fictional.
import dayjs, { type Dayjs } from "dayjs";
import type {
  AuditEntry, AutoRule, Channel, Contact, Contract, Device, GpsObject, Mailing, MessageTemplate,
  Payer, Payment, Sensor, Sim, Subscriber, SubscriberType,
} from "../domain/types";
import { objectPrice } from "../domain/billing";
import { ADDON_BY_ID, REASON_BY_ID, SERVERS, TARIFF_BY_ID } from "./reference";

export interface DemoData {
  version: number;
  subscribers: Subscriber[];
  contacts: Contact[];
  payers: Payer[];
  contracts: Contract[];
  objects: GpsObject[];
  devices: Device[];
  sims: Sim[];
  sensors: Sensor[];
  payments: Payment[];
  audit: AuditEntry[];
  templates: MessageTemplate[];
  rules: AutoRule[];
  mailings: Mailing[];
  seq: { subscriber: number; invoice: number };
}

export const DATA_VERSION = 6;

/** Company requisites used in message templates (question 1.6 — unknown yet). */
export const COMPANY_REQUISITES = "ТОВ «Ваша компанія», IBAN UA00 0000 0000 0000 0000 0000 000";

type ProfileId = "agro" | "intl" | "city" | "machinery" | "municipal" | "medical" | "school" | "car";
type Scenario = "good" | "late" | "late2" | "suspended" | "partial" | "churned";

interface Profile {
  vehicles: string[];
  count: [number, number];
  tariffs: string[];
  addons: [string, number][];
  sensorChance: number;
  models: string[];
}

const PROFILES: Record<ProfileId, Profile> = {
  agro: {
    vehicles: ["John Deere 8R", "Claas Lexion 760", "МТЗ-1221", "Case IH Magnum", "КамАЗ 45143", "Fendt 939", "New Holland T7"],
    count: [4, 9], tariffs: ["ut-pro-m", "ut-start-m", "ut-pro-y"], addons: [["agro", 0.8]], sensorChance: 0.5,
    models: ["fmb125", "fmc130", "eco4"],
  },
  intl: {
    vehicles: ["DAF XF 480", "MAN TGX 18.470", "Volvo FH 500", "Scania R450", "Mercedes-Benz Actros", "Renault T 480", "Iveco S-Way"],
    count: [5, 12], tariffs: ["ut-pro-m", "ut-pro-y"], addons: [["sent", 0.7], ["roaming", 0.85]], sensorChance: 0.3,
    models: ["fmc130", "fmb140", "gv300"],
  },
  city: {
    vehicles: ["Renault Master", "Ford Transit", "VW Crafter", "Mercedes-Benz Sprinter", "Fiat Ducato", "Citroën Jumper", "Peugeot Boxer"],
    count: [2, 6], tariffs: ["fg-base-m", "fg-prem-m", "ut-start-m"], addons: [], sensorChance: 0,
    models: ["fmb920", "fmb125"],
  },
  machinery: {
    vehicles: ["JCB 3CX", "Caterpillar 320", "Komatsu PC210", "МАЗ 5516", "Liebherr LTM 1050", "Hyundai R210"],
    count: [3, 6], tariffs: ["fg-prem-m", "fg-prem-y"], addons: [], sensorChance: 0.6,
    models: ["fmb140", "eco4"],
  },
  municipal: {
    vehicles: ["МАЗ 5337 (сміттєвоз)", "ЗІЛ-130 (поливомийна)", "Богдан А092", "ГАЗ-3309", "Renault Master (аварійна)", "МТЗ-82"],
    count: [4, 8], tariffs: ["ut-start-m", "ut-start-y"], addons: [], sensorChance: 0.25,
    models: ["fmb125", "fmb920"],
  },
  medical: {
    vehicles: ["Renault Master (швидка)", "Mercedes-Benz Sprinter (швидка)", "VW Crafter (швидка)"],
    count: [3, 6], tariffs: ["fg-base-m", "fg-base-y"], addons: [], sensorChance: 0,
    models: ["fmb920", "fmb125"],
  },
  school: {
    vehicles: ["Богдан А092 (шкільний)", "Ataman D093 (шкільний)", "I-VAN A07A (шкільний)"],
    count: [2, 4], tariffs: ["ut-start-y"], addons: [], sensorChance: 0,
    models: ["fmb920"],
  },
  car: {
    vehicles: ["Toyota RAV4", "VW Passat", "Skoda Octavia", "Hyundai Tucson", "Renault Duster", "Kia Sportage", "Mazda CX-5", "Nissan Qashqai"],
    count: [1, 2], tariffs: ["rh-sim-y", "rh-sim-y", "fg-base-m"], addons: [], sensorChance: 0,
    models: ["fmb920"],
  },
};

const ORGS: { name: string; type: SubscriberType; profile: ProfileId; scenario?: Scenario; secondPayer?: string }[] = [
  { name: "ТОВ «Агролайн Поділля»", type: "B2B", profile: "agro" },
  { name: "ТОВ «Трансвектор Логістик»", type: "B2B", profile: "intl" },
  { name: "ТОВ «Зерновий Шлях»", type: "B2B", profile: "agro", scenario: "late" },
  { name: "ФОП Гнатюк Роман Васильович", type: "B2B", profile: "city" },
  { name: "ТОВ «БудМакс Груп»", type: "B2B", profile: "machinery" },
  { name: "ТОВ «Карпатський Експрес»", type: "B2B", profile: "intl" },
  { name: "ТОВ «Дніпро Кейтеринг»", type: "B2B", profile: "city", scenario: "late2" },
  { name: "ТОВ «Еко Вивіз»", type: "B2B", profile: "municipal" },
  { name: "ФОП Литвиненко Оксана Петрівна", type: "B2B", profile: "city", scenario: "churned" },
  { name: "ТОВ «Полтава Агро Інвест»", type: "B2B", profile: "agro" },
  { name: "ТОВ «Сіверлайн»", type: "B2B", profile: "intl", scenario: "partial", secondPayer: "ТОВ «Сіверлайн Транс»" },
  { name: "ТОВ «Фарм Дистриб'юшн Схід»", type: "B2B", profile: "city" },
  { name: "ТОВ «Нафта-Сервіс Південь»", type: "B2B", profile: "machinery" },
  { name: "ФОП Шевчук Ігор Миколайович", type: "B2B", profile: "intl" },
  { name: "ТОВ «Меблі Волині»", type: "B2B", profile: "city", scenario: "suspended" },
  { name: "ТОВ «Техно Оренда»", type: "B2B", profile: "machinery", secondPayer: "ФОП Коваленко Віктор Іванович" },
  { name: "КП «Міське зелене господарство»", type: "B2G", profile: "municipal" },
  { name: "КП «Комунсервіс»", type: "B2G", profile: "municipal", scenario: "late" },
  { name: "КНП «Центр екстреної медичної допомоги»", type: "B2G", profile: "medical" },
  { name: "Відділ освіти Вишнівської громади", type: "B2G", profile: "school" },
];

const B2C_SCENARIOS: Scenario[] = ["good", "late", "good", "suspended", "good", "good", "good", "churned", "good", "good", "good", "good"];

const MALE = ["Андрій", "Олександр", "Сергій", "Віктор", "Ігор", "Дмитро", "Максим", "Юрій", "Богдан", "Василь", "Олег", "Тарас", "Роман", "Микола"];
const FEMALE = ["Олена", "Ірина", "Наталія", "Оксана", "Тетяна", "Юлія", "Світлана", "Марія", "Галина", "Людмила"];
const LAST = ["Шевченко", "Бондаренко", "Коваленко", "Ткаченко", "Кравченко", "Олійник", "Поліщук", "Лисенко", "Мороз", "Марченко", "Руденко", "Савчук", "Климчук", "Гончаренко", "Павленко", "Кузьменко", "Харченко", "Сидоренко", "Петрук", "Дорошенко"];
const PATR_M = ["Іванович", "Петрович", "Васильович", "Миколайович", "Олександрович", "Сергійович"];
const PATR_F = ["Іванівна", "Петрівна", "Василівна", "Миколаївна", "Олександрівна", "Сергіївна"];
const PLATE_REGIONS = ["АА", "ВС", "АІ", "ВО", "ВК", "КА", "АХ", "ВН", "ВІ", "АЕ"];
const PLATE_LETTERS = ["А", "В", "Е", "І", "К", "М", "Н", "О", "Р", "С", "Т", "Х"];
const MOBILE_CODES = ["50", "66", "95", "99", "67", "97", "63", "73", "93"];

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
  ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia",
};
const translit = (s: string) =>
  s.toLowerCase().split("").map((c) => TRANSLIT[c] ?? (/[a-z0-9]/.test(c) ? c : c === " " ? "-" : "")).join("").replace(/-+/g, "-").replace(/^-|-$/g, "");

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateDemoData(today: Dayjs, seed = 20260927): DemoData {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
  const chance = (p: number) => rnd() < p;
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join("");
  const fmt = (d: Dayjs) => d.format("YYYY-MM-DD");
  const at = (d: Dayjs | string) => dayjs(d).hour(int(9, 18)).minute(int(0, 59)).toISOString();
  let uid = 0;
  const nextId = (prefix: string) => `${prefix}${(++uid).toString(36)}`;

  const subscribers: Subscriber[] = [];
  const contacts: Contact[] = [];
  const payers: Payer[] = [];
  const contracts: Contract[] = [];
  const objects: GpsObject[] = [];
  const devices: Device[] = [];
  const sims: Sim[] = [];
  const sensors: Sensor[] = [];
  const payments: Payment[] = [];
  const audit: AuditEntry[] = [];
  let invoiceSeq = 1;
  let contractSeq = 1;

  const person = () => {
    const female = chance(0.4);
    return {
      first: pick(female ? FEMALE : MALE),
      last: pick(LAST),
      patr: pick(female ? PATR_F : PATR_M),
    };
  };
  const phone = () => `+380 ${pick(MOBILE_CODES)} ${digits(3)} ${digits(2)} ${digits(2)}`;
  const plate = () => `${pick(PLATE_REGIONS)} ${digits(4)} ${pick(PLATE_LETTERS)}${pick(PLATE_LETTERS)}`;
  const viberId = () => {
    const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    return Array.from({ length: 22 }, () => pick(abc.split(""))).join("") + "==";
  };
  const pickChannel = (): Channel => {
    const r = rnd();
    return r < 0.55 ? "telegram" : r < 0.85 ? "viber" : "email";
  };
  const log = (e: Omit<AuditEntry, "id">) => audit.push({ id: nextId("a"), ...e });

  const specs = [
    ...ORGS,
    ...B2C_SCENARIOS.map((scenario) => ({ name: "", type: "B2C" as SubscriberType, profile: "car" as ProfileId, scenario, secondPayer: undefined })),
  ];

  specs.forEach((spec, idx) => {
    const scenario: Scenario = spec.scenario ?? "good";
    const profile = PROFILES[spec.profile];
    const managerId = idx % 3 === 0 ? "u-m2" : "u-m1";
    const createdAt = today
      .subtract(scenario === "churned" ? int(16, 34) : int(3, 36), "month")
      .subtract(int(0, 27), "day");

    let name = spec.name;
    const self = person();
    if (spec.type === "B2C") name = `${self.last} ${self.first} ${self.patr}`;
    const isFop = name.startsWith("ФОП");
    const taxId = spec.type === "B2C" ? (chance(0.5) ? digits(10) : undefined) : isFop ? digits(10) : digits(8);
    const code = `AB-${String(idx + 1).padStart(5, "0")}`;
    const sub: Subscriber = {
      id: nextId("s"),
      code,
      type: spec.type,
      name,
      taxId,
      crmUrl: `https://crm.example.com/companies/${int(10000, 99999)}`,
      managerId,
      createdAt: fmt(createdAt),
    };
    subscribers.push(sub);
    log({ at: at(createdAt), userId: managerId, entity: "subscriber", entityId: sub.id, subscriberId: sub.id, action: "Створено абонента", details: `${code} · ${name}` });

    // Payers
    const mainPayer: Payer = {
      id: nextId("p"),
      subscriberId: sub.id,
      name,
      taxId,
      iban: spec.type === "B2C" ? undefined : `UA${digits(27)}`,
      method: spec.type === "B2C" ? pick(["iban", "card"] as const) : "invoice",
    };
    payers.push(mainPayer);
    const subPayers = [mainPayer];
    if (spec.secondPayer) {
      const second: Payer = {
        id: nextId("p"),
        subscriberId: sub.id,
        name: spec.secondPayer,
        taxId: spec.secondPayer.startsWith("ФОП") ? digits(10) : digits(8),
        iban: `UA${digits(27)}`,
        method: "invoice",
      };
      payers.push(second);
      subPayers.push(second);
    }

    // Contracts
    if (spec.type !== "B2C" && (spec.type === "B2G" || chance(0.85))) {
      for (const payer of subPayers) {
        const signed = createdAt.add(int(0, 10), "day");
        let validUntil = signed.add(1, "year").subtract(1, "day");
        if (spec.type === "B2G") validUntil = today.endOf("year");
        else while (validUntil.isBefore(today.subtract(20, "day"))) validUntil = validUntil.add(1, "year");
        const number = `ГПС-${signed.year()}/${String(contractSeq++).padStart(3, "0")}`;
        contracts.push({
          id: nextId("k"),
          subscriberId: sub.id,
          payerId: payer.id,
          number,
          signedAt: fmt(signed),
          validUntil: fmt(validUntil),
          autoRenew: spec.type === "B2B" && chance(0.7),
          fileName: `Договір ${number.replace("/", "-")}.pdf`,
        });
      }
    }

    // Contacts
    const domain = spec.type === "B2C" ? "example.com" : `${translit(name.replace(/^(ТОВ|ФОП|КП|КНП)\s*/, "").replace(/[«»']/g, "")).slice(0, 24)}.example.com`;
    const addContact = (p: ReturnType<typeof person>, position: string | undefined, isPrimary: boolean, billing: boolean, tech: boolean) => {
      const channel = pickChannel();
      const email = channel === "email" || chance(billing ? 0.8 : 0.4) ? `${translit(p.last)}.${translit(p.first).slice(0, 1)}@${domain}` : undefined;
      contacts.push({
        id: nextId("c"),
        subscriberId: sub.id,
        fullName: `${p.last} ${p.first} ${p.patr}`,
        position,
        phone: phone(),
        phone2: chance(0.2) ? phone() : undefined,
        email,
        telegramChatId: channel === "telegram" || chance(0.3) ? digits(int(9, 10)).replace(/^0/, "5") : undefined,
        viberChatId: channel === "viber" || chance(0.2) ? viberId() : undefined,
        channel,
        isPrimary,
        billingNotify: billing,
        techNotify: tech,
        active: true,
        crmUrl: `https://crm.example.com/contacts/${int(100000, 999999)}`,
      });
    };
    if (spec.type === "B2C") {
      addContact(self, undefined, true, true, true);
    } else {
      const hasAccountant = chance(0.8);
      const boss = isFop ? { last: name.split(" ")[1], first: name.split(" ")[2], patr: name.split(" ")[3] } : person();
      addContact(boss, isFop ? "Власник (ФОП)" : pick(["Директор", "Керівник транспортного відділу", "Заступник директора"]), true, !hasAccountant, true);
      if (hasAccountant) addContact(person(), pick(["Головний бухгалтер", "Бухгалтер"]), false, true, false);
      if (chance(0.5)) addContact(person(), pick(["Диспетчер", "Механік", "Логіст"]), false, false, true);
    }

    // Objects
    const count = int(profile.count[0], profile.count[1]);
    const primaryTariff = pick(profile.tariffs);
    const churnDate = today.subtract(int(40, 300), "day");
    const churnReason = spec.type === "B2C" ? "sold" : "competitor";
    for (let i = 0; i < count; i++) {
      const tariffId = i < Math.ceil(count * 0.75) ? primaryTariff : pick(profile.tariffs);
      const tariff = TARIFF_BY_ID[tariffId];
      const programId = tariff.programId;
      const server = pick(SERVERS.filter((s) => s.programId === programId));
      const addonIds = profile.addons
        .filter(([id, p]) => chance(p) && ADDON_BY_ID[id].programIds.includes(programId))
        .map(([id]) => id);
      const payer = subPayers.length > 1 && i % 2 === 1 ? subPayers[1] : subPayers[0];

      const latest = scenario === "churned" ? churnDate.subtract(60, "day") : today.subtract(15, "day");
      let connected = i === 0 ? createdAt : createdAt.add(int(0, Math.max(0, latest.diff(createdAt, "day"))), "day");
      if (connected.isAfter(latest)) connected = latest;

      let status: GpsObject["status"] = "active";
      let paidUntil: Dayjs;
      let disconnectedAt: Dayjs | undefined;
      let reasonId: string | undefined;

      const nextAnniversary = () => {
        let a = connected;
        while (!a.isAfter(today)) a = a.add(1, "year");
        return a.subtract(1, "day");
      };
      const lastAnniversary = () => {
        let a = connected;
        while (!a.add(1, "year").isAfter(today)) a = a.add(1, "year");
        return a;
      };
      const paidUp = () => (tariff.period === "year" ? nextAnniversary() : today.endOf("month"));

      const objScenario: Scenario =
        scenario === "partial" ? (payer.id === subPayers[0].id ? "good" : "suspended") : scenario;
      if (objScenario === "churned") {
        status = "disconnected";
        disconnectedAt = churnDate.add(int(0, 5), "day");
        reasonId = churnReason;
        paidUntil = disconnectedAt;
      } else if (objScenario === "suspended") {
        status = "suspended";
        // Annual tariffs: the current year was not paid; monthly: 1–3 months behind.
        paidUntil = tariff.period === "year" ? lastAnniversary().subtract(1, "day") : today.subtract(int(1, 3), "month").endOf("month");
      } else if ((objScenario === "late" || objScenario === "late2") && tariff.period === "month") {
        // Keep the overdue past the grace period whatever day of the month the demo is opened.
        const behind = (today.date() < 15 ? 2 : 1) + (objScenario === "late2" ? 1 : 0);
        paidUntil = today.subtract(behind, "month").endOf("month");
      } else if (chance(0.08) && today.diff(connected, "day") > 90) {
        status = "disconnected";
        disconnectedAt = connected.add(int(60, today.diff(connected, "day") - 5), "day");
        reasonId = pick(["sold", "season", "other", "nonpay", "sold"]);
        paidUntil = disconnectedAt;
      } else {
        paidUntil = paidUp();
      }

      const vehicle = pick(profile.vehicles);
      const obj: GpsObject = {
        id: nextId("o"),
        subscriberId: sub.id,
        payerId: payer.id,
        name: vehicle,
        plate: spec.profile === "agro" && !vehicle.startsWith("КамАЗ") ? undefined : plate(),
        programId,
        serverId: server.id,
        tariffId,
        addonIds,
        discount: chance(0.1) ? pick([20, 30, 50]) : 0,
        status,
        connectedAt: fmt(connected),
        disconnectedAt: disconnectedAt ? fmt(disconnectedAt) : undefined,
        disconnectReasonId: reasonId,
        paidUntil: fmt(paidUntil),
      };
      objects.push(obj);

      const device: Device = {
        id: nextId("d"),
        imei: `35${digits(13)}`,
        modelId: chance(0.08) ? undefined : pick(profile.models),
        status: status === "disconnected" ? "dismantled" : "installed",
        ownership: chance(0.7) ? "sold" : "rent",
        objectId: obj.id,
      };
      devices.push(device);
      const kyivstar = chance(0.08);
      const sim: Sim = {
        id: nextId("m"),
        iccid: `${kyivstar ? "8938003" : "8938001"}${digits(12)}`,
        msisdn: `+380 ${kyivstar ? pick(["67", "97"]) : pick(["50", "66", "95", "99"])} ${digits(3)} ${digits(2)} ${digits(2)}`,
        planId: kyivstar ? "ks-m2m" : addonIds.includes("roaming") ? "vf-roam" : "vf-m2m",
        status: status === "disconnected" ? "blocked" : "active",
        deviceId: device.id,
      };
      sims.push(sim);
      obj.deviceId = device.id;
      obj.simId = sim.id;

      if (chance(profile.sensorChance)) {
        const n = chance(0.3) ? 2 : 1;
        for (let k = 0; k < n; k++) sensors.push({ id: nextId("n"), sn: `${pick(["LLS-", "TD-"])}${digits(6)}`, kind: "ДУТ", objectId: obj.id });
      }

      log({ at: at(connected), userId: "u-tech", entity: "object", entityId: obj.id, subscriberId: sub.id, action: "Підключено об'єкт", details: `${vehicle} · IMEI ${device.imei}` });
      const tariffChangedAt = connected.add(int(2, 8), "month");
      if (tariffId === "ut-pro-m" && chance(0.25) && tariffChangedAt.isBefore(today)) {
        log({ at: at(tariffChangedAt), userId: managerId, entity: "object", entityId: obj.id, subscriberId: sub.id, action: "Змінено тариф", details: "Unitrack Start → Unitrack Pro" });
      }
      if (status === "suspended") {
        log({ at: at(paidUntil.add(11, "day")), userId: "u-tech", entity: "object", entityId: obj.id, subscriberId: sub.id, action: "Призупинено об'єкт", details: `${vehicle} · несплата` });
      }
      if (disconnectedAt) {
        log({ at: at(disconnectedAt), userId: "u-tech", entity: "object", entityId: obj.id, subscriberId: sub.id, action: "Відключено об'єкт", details: `${vehicle} · причина: ${REASON_BY_ID[reasonId ?? ""]?.name ?? "—"}` });
      }
    }

    // Payments history per payer
    for (const payer of subPayers) {
      const own = objects.filter((o) => o.payerId === payer.id);
      const monthly = own.filter((o) => TARIFF_BY_ID[o.tariffId].period === "month");
      const yearly = own.filter((o) => TARIFF_BY_ID[o.tariffId].period === "year");
      const isInvoice = payer.method === "invoice";
      const addPayment = (amount: number, paidAt: Dayjs, from: Dayjs, to: Dayjs, objectIds: string[]) => {
        const paid = paidAt.isAfter(today) ? today : paidAt;
        payments.push({
          id: nextId("y"),
          subscriberId: sub.id,
          payerId: payer.id,
          invoiceNo: isInvoice ? `Р-${from.format("YYMM")}-${String(invoiceSeq++).padStart(4, "0")}` : undefined,
          amount: Math.round(amount),
          paidAt: fmt(paid),
          periodFrom: fmt(from),
          periodTo: fmt(to),
          objectIds,
          method: payer.method,
          createdBy: managerId,
        });
      };
      if (monthly.length) {
        const start = dayjs(monthly.map((o) => o.connectedAt).sort()[0]).startOf("month");
        for (let m = start; !m.isAfter(today, "month"); m = m.add(1, "month")) {
          const end = m.endOf("month");
          const covered = monthly.filter((o) => !dayjs(o.connectedAt).isAfter(end) && !dayjs(o.paidUntil).isBefore(end, "day"));
          if (!covered.length) continue;
          const amount = covered.reduce((s, o) => s + objectPrice(o).total, 0);
          addPayment(amount, m.date(int(1, 10)), m, end, covered.map((o) => o.id));
        }
      }
      for (const o of yearly) {
        const t = TARIFF_BY_ID[o.tariffId];
        const price = objectPrice(o);
        const amount = t.price + (price.addons - price.discount) * 12;
        for (let a = dayjs(o.connectedAt); !a.isAfter(dayjs(o.paidUntil)); a = a.add(1, "year")) {
          addPayment(amount, a.add(int(0, 3), "day"), a, a.add(1, "year").subtract(1, "day"), [o.id]);
        }
      }
    }
    const recent = payments.filter((p) => p.subscriberId === sub.id).sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 2);
    for (const p of recent) {
      log({ at: at(p.paidAt), userId: managerId, entity: "payment", entityId: p.id, subscriberId: sub.id, action: "Внесено оплату", details: `${p.amount.toLocaleString("uk-UA")} грн · ${dayjs(p.periodFrom).format("DD.MM.YYYY")}–${dayjs(p.periodTo).format("DD.MM.YYYY")}` });
    }
  });

  // Warehouse stock: devices and SIM cards not installed anywhere
  const stockModels = ["fmb920", "fmb920", "fmb125", "fmc130", "fmb140", "eco4"];
  for (let i = 0; i < 19; i++) {
    const status: Device["status"] = i < 14 ? "in_stock" : i < 17 ? "repair" : "written_off";
    devices.push({ id: nextId("d"), imei: `35${digits(13)}`, modelId: pick(stockModels), status, ownership: "rent" });
  }
  for (let i = 0; i < 22; i++) {
    sims.push({ id: nextId("m"), iccid: `8938001${digits(12)}`, msisdn: `+380 ${pick(["50", "66", "95", "99"])} ${digits(3)} ${digits(2)} ${digits(2)}`, planId: "vf-m2m", status: "in_stock" });
  }

  const templates: MessageTemplate[] = [
    {
      id: "t-reminder", kind: "reminder", name: "Нагадування про оплату",
      subject: "Нагадування про оплату GPS-моніторингу",
      body: "Доброго дня, {{name}}!\nНагадуємо, що {{paid_until}} закінчується оплачений період GPS-моніторингу ({{objects}} об'єкт(ів)).\nСума до сплати: {{amount}} грн.\nРеквізити: {{requisites}}.\nДякуємо, що з нами!",
    },
    {
      id: "t-debt", kind: "debt", name: "Повідомлення про заборгованість",
      subject: "Заборгованість за GPS-моніторинг",
      body: "Доброго дня, {{name}}!\nЗа абонентом {{company}} ({{code}}) обліковується заборгованість {{debt}} грн за GPS-моніторинг.\nЩоб уникнути призупинення доступу, просимо сплатити найближчим часом.\nРеквізити: {{requisites}}.\nЯкщо оплату вже здійснено — просто проігноруйте це повідомлення.",
    },
    {
      id: "t-invoice", kind: "invoice", name: "Рахунок та реквізити",
      subject: "Рахунок на оплату GPS-моніторингу",
      body: "Доброго дня, {{name}}!\nНадсилаємо рахунок на оплату GPS-моніторингу: {{objects}} об'єкт(ів), сума {{amount}} грн на місяць.\nРеквізити: {{requisites}}.\nРахунок — у вкладенні.",
    },
    {
      id: "t-tech", kind: "tech", name: "Технічні роботи на сервері",
      subject: "Планові технічні роботи",
      body: "Шановні клієнти!\nУ ніч із суботи на неділю з 02:00 до 04:00 на сервері моніторингу проводитимуться планові технічні роботи.\nМожливі короткочасні перерви в оновленні даних. Вибачте за незручності.",
    },
    {
      id: "t-contract", kind: "info", name: "Закінчується термін договору",
      subject: "Термін дії договору",
      body: "Доброго дня, {{name}}!\nНагадуємо, що незабаром закінчується термін дії договору з {{company}}.\nВаш менеджер {{manager}} зв'яжеться з вами щодо продовження.",
    },
    {
      id: "t-info", kind: "info", name: "Зміна тарифів",
      subject: "Зміна тарифів з 1 січня",
      body: "Доброго дня, {{name}}!\nПовідомляємо, що з 1 січня змінюються тарифи на GPS-моніторинг.\nДеталі — у вашого менеджера {{manager}}.",
    },
  ];

  const rules: AutoRule[] = [
    { id: "r-reminder", name: "Нагадування перед закінченням оплати", description: "За 3 дні до дати «оплачено до»", templateId: "t-reminder", enabled: true, schedule: "щодня о 10:00" },
    { id: "r-debt", name: "Повідомлення про заборгованість", description: "На 1, 5 і 10 день прострочення", templateId: "t-debt", enabled: true, schedule: "щодня о 10:30" },
    { id: "r-invoice", name: "Рахунок на новий період", description: "1-го числа — платникам з оплатою за рахунком", templateId: "t-invoice", enabled: false, schedule: "1-го числа о 09:00" },
    { id: "r-contract", name: "Закінчення договору", description: "За 30 днів до закінчення терміну дії договору", templateId: "t-contract", enabled: false, schedule: "щопонеділка о 10:00" },
  ];

  const mailings: Mailing[] = [
    { id: "ml-1", createdAt: at(today.subtract(61, "day")), userId: "u-admin", templateId: "t-tech", audience: "Усі активні абоненти · Unitrack", byChannel: { telegram: 41, viber: 22, email: 9 }, skipped: 3 },
    { id: "ml-2", createdAt: at(today.subtract(19, "day")), userId: "u-m1", templateId: "t-debt", audience: "Абоненти з боргом · B2B", byChannel: { telegram: 6, viber: 3, email: 2 }, skipped: 1 },
    { id: "ml-3", createdAt: at(today.subtract(4, "day")), userId: "u-m2", templateId: "t-reminder", audience: "Оплата закінчується цього місяця", byChannel: { telegram: 18, viber: 11, email: 4 }, skipped: 2 },
  ];

  audit.sort((a, b) => b.at.localeCompare(a.at));

  return {
    version: DATA_VERSION,
    subscribers, contacts, payers, contracts, objects, devices, sims, sensors, payments, audit, templates, rules, mailings,
    seq: { subscriber: subscribers.length, invoice: invoiceSeq },
  };
}
