import type { ReasonKey } from "./seed-demo.references.ts";

// The clients of the demo: names from the public demo (tag `demo`, D37), all invented. Days are counted back from the
// day of the run, so a contract that ends in 12 days ends in 12 days whenever the seed runs.

export interface ObjectPlan {
  vehicle: string;
  // An index into the tracker models of seed-demo.references.ts
  model: number;
  addons?: string[];
  sensors?: number;
  // Changed later in the story, as a person would on the card
  status?: { to: "suspended" | "disconnected"; ago: number; reason?: ReasonKey };
  // A tariff of its own from this many days ago, or from the 1st of next month
  ownTariff?: { key: string; ago: number | "next month" };
  replacedAgo?: number;
  // Paid by the payer the client shares with another one, from this many days ago
  sharedPayerAgo?: number;
  archivedAlone?: boolean;
}

export interface ContactPlan {
  name: string;
  position?: string;
  channel: "telegram" | "viber" | "email";
  isBillingOnly?: boolean;
}

export interface ContractPlan {
  number: string;
  // Negative: signed in some days, the contract waits for signing
  signedAgo: number;
  days: number;
  terminatedAgo?: number;
  files: number;
  isWithSharedPayer?: boolean;
}

export interface ClientPlan {
  name: string;
  type: "B2C" | "B2B" | "B2G";
  tax?: "edrpou" | "ipn";
  tariff: string;
  sinceAgo: number;
  payment: "invoice" | "vchasno" | "iban";
  contacts: ContactPlan[];
  contracts?: ContractPlan[];
  objects: ObjectPlan[];
  graceDays?: number;
  discountKop?: number;
  note?: string;
  legacyCode?: string;
  pastTariff?: { key: string; ago: number };
  plannedTariff?: string;
  // Also paid for by the payer of the client named here (К6: one payer pays for several clients)
  sharesPayerOf?: string;
  isArchived?: boolean;
}

// Models: 0 FMB920, 1 FMB125, 2 FMC130, 3 FMB140, 4 FM-Eco4 light+, 5 GV300
export const CLIENTS: ClientPlan[] = [
  {
    name: "ТОВ «Агролайн Поділля»",
    type: "B2B",
    tax: "edrpou",
    tariff: "u1ProM",
    sinceAgo: 820,
    payment: "invoice",
    graceDays: 10,
    legacyCode: "A-0142",
    note: "Сезонні роботи з квітня по листопад",
    contacts: [
      { name: "Коваленко Віктор Іванович", position: "Директор", channel: "telegram" },
      { name: "Савчук Ірина Петрівна", position: "Бухгалтер", channel: "email", isBillingOnly: true },
    ],
    contracts: [{ number: "Д-2024/031", signedAgo: 700, days: 1095, files: 2 }],
    objects: [
      { vehicle: "John Deere 8R", model: 2, addons: ["agro"], sensors: 1 },
      { vehicle: "Claas Lexion 760", model: 4, addons: ["agro"], sensors: 1, status: { to: "suspended", ago: 45 } },
      { vehicle: "МТЗ-1221", model: 1 },
      { vehicle: "Case IH Magnum", model: 2, addons: ["agro"] },
      { vehicle: "КамАЗ 45143", model: 1, sensors: 1 },
    ],
  },
  {
    name: "ТОВ «Трансвектор Логістик»",
    type: "B2B",
    tax: "edrpou",
    tariff: "u1ProY",
    sinceAgo: 640,
    payment: "vchasno",
    legacyCode: "A-0217",
    contacts: [
      { name: "Марченко Олег Сергійович", position: "Диспетчер", channel: "viber" },
      { name: "Лисенко Наталія Іванівна", position: "Бухгалтер", channel: "email", isBillingOnly: true },
    ],
    contracts: [{ number: "Д-2025/007", signedAgo: 353, days: 365, files: 1 }],
    objects: [
      { vehicle: "DAF XF 480", model: 2, addons: ["roaming"] },
      { vehicle: "MAN TGX 18.470", model: 2, addons: ["roaming"], replacedAgo: 90 },
      { vehicle: "Volvo FH 500", model: 3, addons: ["roaming", "sent"] },
      { vehicle: "Scania R450", model: 5, addons: ["sent"] },
      { vehicle: "Mercedes-Benz Actros", model: 3, addons: ["roaming"] },
      { vehicle: "Renault T 480", model: 2, status: { to: "disconnected", ago: 30, reason: "sold" } },
    ],
  },
  {
    name: "ТОВ «Зерновий Шлях»",
    type: "B2B",
    tax: "edrpou",
    tariff: "u2StartM",
    pastTariff: { key: "u2ProM", ago: 150 },
    sinceAgo: 560,
    payment: "invoice",
    contacts: [{ name: "Руденко Тарас Миколайович", position: "Головний агроном", channel: "telegram" }],
    contracts: [
      { number: "Д-2023/112", signedAgo: 800, days: 365, files: 1 },
      { number: "Д-2025/044", signedAgo: 430, days: 730, files: 1 },
    ],
    objects: [
      { vehicle: "Fendt 939", model: 4, sensors: 1 },
      { vehicle: "New Holland T7", model: 1 },
      { vehicle: "МТЗ-1221", model: 1, status: { to: "suspended", ago: 30 } },
    ],
  },
  {
    name: "ФОП Гнатюк Роман Васильович",
    type: "B2B",
    tax: "ipn",
    tariff: "fgBaseM",
    sinceAgo: 400,
    payment: "invoice",
    contacts: [{ name: "Гнатюк Роман Васильович", channel: "telegram" }],
    contracts: [{ number: "Д-2025/058", signedAgo: 380, days: 730, files: 1 }],
    objects: [
      { vehicle: "Renault Master", model: 0 },
      { vehicle: "Ford Transit", model: 0 },
    ],
  },
  {
    name: "ТОВ «БудМакс Груп»",
    type: "B2B",
    tax: "edrpou",
    tariff: "fgPremM",
    sinceAgo: 700,
    payment: "invoice",
    contacts: [{ name: "Гончаренко Сергій Петрович", position: "Головний механік", channel: "viber" }],
    contracts: [{ number: "Д-2024/090", signedAgo: 600, days: 1095, files: 1 }],
    objects: [
      { vehicle: "JCB 3CX", model: 3, sensors: 1 },
      { vehicle: "Caterpillar 320", model: 4, sensors: 1, ownTariff: { key: "fgPremY", ago: 200 } },
      { vehicle: "Komatsu PC210", model: 3 },
      { vehicle: "МАЗ 5516", model: 1 },
    ],
  },
  {
    name: "ТОВ «Карпатський Експрес»",
    type: "B2B",
    tax: "edrpou",
    tariff: "u1ProM",
    sinceAgo: 480,
    payment: "invoice",
    contacts: [{ name: "Павленко Юрій Васильович", position: "Логіст", channel: "telegram" }],
    contracts: [{ number: "Д-2025/021", signedAgo: 470, days: 730, files: 0 }],
    objects: [
      { vehicle: "Iveco S-Way", model: 2, addons: ["roaming"] },
      { vehicle: "DAF XF 480", model: 2, addons: ["roaming"] },
      { vehicle: "Scania R450", model: 5 },
    ],
  },
  {
    name: "ТОВ «Еко Вивіз»",
    type: "B2B",
    tax: "edrpou",
    tariff: "u1StartM",
    plannedTariff: "u1Start2027M",
    sinceAgo: 520,
    payment: "invoice",
    contacts: [{ name: "Кузьменко Андрій Олегович", position: "Диспетчер", channel: "email" }],
    contracts: [{ number: "Д-2024/140", signedAgo: 500, days: 1095, files: 1 }],
    objects: [
      { vehicle: "МАЗ 5337 (сміттєвоз)", model: 1 },
      { vehicle: "ГАЗ-3309", model: 0 },
      { vehicle: "Renault Master (аварійна)", model: 0 },
    ],
  },
  {
    name: "ТОВ «Полтава Агро Інвест»",
    type: "B2B",
    tax: "edrpou",
    tariff: "u1StartM",
    plannedTariff: "u1Start2027M",
    sinceAgo: 380,
    payment: "invoice",
    sharesPayerOf: "ТОВ «Агролайн Поділля»",
    contacts: [{ name: "Харченко Микола Іванович", position: "Директор", channel: "telegram" }],
    contracts: [
      { number: "Д-2025/066", signedAgo: 360, days: 730, files: 1 },
      { number: "Д-2025/101", signedAgo: 90, days: 365, files: 1, isWithSharedPayer: true },
    ],
    objects: [
      { vehicle: "John Deere 8R", model: 2, addons: ["agro"], sensors: 1 },
      { vehicle: "Claas Lexion 760", model: 4, addons: ["agro"] },
      { vehicle: "МТЗ-1221", model: 1, sharedPayerAgo: 90 },
    ],
  },
  {
    name: "ТОВ «Техно Оренда»",
    type: "B2B",
    tax: "edrpou",
    tariff: "fgPremY",
    sinceAgo: 600,
    payment: "invoice",
    contacts: [{ name: "Сидоренко Ігор Петрович", position: "Менеджер з оренди", channel: "viber" }],
    contracts: [
      { number: "Д-2023/077", signedAgo: 560, days: 1095, terminatedAgo: 200, files: 1 },
      { number: "Д-2025/080", signedAgo: 199, days: 730, files: 1 },
    ],
    objects: [
      { vehicle: "Liebherr LTM 1050", model: 3, sensors: 1 },
      { vehicle: "Hyundai R210", model: 4 },
    ],
  },
  {
    name: "ФОП Литвиненко Оксана Петрівна",
    type: "B2B",
    tax: "ipn",
    tariff: "fgBaseM",
    sinceAgo: 450,
    payment: "iban",
    isArchived: true,
    contacts: [{ name: "Литвиненко Оксана Петрівна", channel: "viber" }],
    contracts: [{ number: "Д-2025/012", signedAgo: 440, days: 730, files: 1 }],
    objects: [{ vehicle: "Fiat Ducato", model: 0, status: { to: "disconnected", ago: 40, reason: "closed" } }],
  },
  {
    name: "КП «Міське зелене господарство»",
    type: "B2G",
    tax: "edrpou",
    tariff: "u1StartY",
    sinceAgo: 610,
    payment: "invoice",
    note: "Оплата після підписання акта",
    contacts: [
      { name: "Петрук Галина Миколаївна", position: "Начальник гаража", channel: "email" },
      { name: "Дорошенко Людмила Василівна", position: "Бухгалтер", channel: "email", isBillingOnly: true },
    ],
    contracts: [{ number: "Д-2025/003", signedAgo: 310, days: 365, files: 1 }],
    objects: [
      { vehicle: "МТЗ-82", model: 1 },
      { vehicle: "ЗІЛ-130 (поливомийна)", model: 1 },
      { vehicle: "Богдан А092", model: 0 },
      { vehicle: "Renault Master", model: 0 },
    ],
  },
  {
    name: "КП «Комунсервіс»",
    type: "B2G",
    tax: "edrpou",
    tariff: "u2StartM",
    sinceAgo: 530,
    payment: "invoice",
    contacts: [{ name: "Климчук Василь Іванович", position: "Механік", channel: "telegram" }],
    contracts: [{ number: "Д-2024/150", signedAgo: 520, days: 1095, files: 1 }],
    objects: [
      { vehicle: "МАЗ 5337", model: 1 },
      { vehicle: "ГАЗ-3309", model: 0, status: { to: "disconnected", ago: 20, reason: "nonpay" } },
      { vehicle: "МТЗ-82", model: 1, status: { to: "disconnected", ago: 75, reason: "other" }, archivedAlone: true },
    ],
  },
  {
    name: "КНП «Центр екстреної медичної допомоги»",
    type: "B2G",
    tax: "edrpou",
    tariff: "fgBaseY",
    sinceAgo: 300,
    payment: "invoice",
    contacts: [{ name: "Поліщук Ірина Олександрівна", position: "Завідувач гаража", channel: "email" }],
    contracts: [
      { number: "Д-2025/090", signedAgo: 290, days: 365, files: 1 },
      { number: "Д-2026/015", signedAgo: -5, days: 365, files: 0 },
    ],
    objects: [
      { vehicle: "Renault Master (швидка)", model: 0 },
      { vehicle: "Mercedes-Benz Sprinter (швидка)", model: 1 },
      { vehicle: "VW Crafter (швидка)", model: 0 },
    ],
  },
  {
    name: "Відділ освіти Вишнівської громади",
    type: "B2G",
    tax: "edrpou",
    tariff: "u1StartY",
    sinceAgo: 420,
    payment: "invoice",
    contacts: [{ name: "Ткаченко Оксана Сергіївна", position: "Методист", channel: "email" }],
    contracts: [{ number: "Д-2025/033", signedAgo: 410, days: 730, files: 1 }],
    objects: [
      { vehicle: "Богдан А092 (шкільний)", model: 0 },
      { vehicle: "Ataman D093 (шкільний)", model: 0 },
    ],
  },
  {
    name: "Бондаренко Олена Петрівна",
    type: "B2C",
    tariff: "rhSimY",
    sinceAgo: 350,
    payment: "iban",
    contacts: [{ name: "Бондаренко Олена Петрівна", channel: "telegram" }],
    objects: [{ vehicle: "Toyota RAV4", model: 0 }],
  },
  {
    name: "Ткаченко Дмитро Сергійович",
    type: "B2C",
    tax: "ipn",
    tariff: "fgBaseM",
    sinceAgo: 260,
    payment: "iban",
    legacyCode: "Ф-0881",
    contacts: [{ name: "Ткаченко Дмитро Сергійович", channel: "viber" }],
    objects: [
      { vehicle: "VW Passat", model: 0 },
      { vehicle: "Skoda Octavia", model: 0, status: { to: "suspended", ago: 15 } },
    ],
  },
  {
    name: "Кравченко Ігор Миколайович",
    type: "B2C",
    tax: "ipn",
    tariff: "rhSimY",
    sinceAgo: 500,
    payment: "iban",
    contacts: [{ name: "Кравченко Ігор Миколайович", channel: "telegram" }],
    objects: [{ vehicle: "Hyundai Tucson", model: 0 }],
  },
  {
    name: "Олійник Тетяна Василівна",
    type: "B2C",
    tariff: "u2StartM",
    sinceAgo: 180,
    payment: "iban",
    graceDays: 10,
    discountKop: 2_000,
    contacts: [{ name: "Олійник Тетяна Василівна", channel: "email" }],
    objects: [{ vehicle: "Kia Sportage", model: 0 }],
  },
  {
    name: "Мороз Віктор Олександрович",
    type: "B2C",
    tariff: "fgBaseM",
    sinceAgo: 230,
    payment: "iban",
    contacts: [{ name: "Мороз Віктор Олександрович", channel: "telegram" }],
    objects: [{ vehicle: "Mazda CX-5", model: 0, ownTariff: { key: "fgPremM", ago: "next month" } }],
  },
  {
    name: "Шевченко Андрій Іванович",
    type: "B2C",
    tax: "ipn",
    tariff: "rhSimY",
    sinceAgo: 120,
    payment: "iban",
    contacts: [{ name: "Шевченко Андрій Іванович", channel: "viber" }],
    objects: [
      { vehicle: "Nissan Qashqai", model: 0 },
      { vehicle: "Renault Duster", model: 0 },
    ],
  },
];

// Equipment that is on no object: in stock, in repair, written off into the archive (models as above)
export const STOCK = {
  devices: [0, 0, 2, 5],
  repair: [1],
  writtenOff: [1],
  freeSims: 4,
  blockedSims: 1,
  sensors: 2,
};
