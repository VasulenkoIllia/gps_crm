import type { ReferenceKind } from "@gps_crm/shared";

interface ReferenceTexts {
  tab: string;
  add: string;
  empty: string;
  // Said on top of the usual consequence, when the record takes others along
  cascadeNote?: string;
}

export const REFERENCE_TEXTS: Record<ReferenceKind, ReferenceTexts> = {
  programs: {
    tab: "Програми",
    add: "Додати програму",
    empty: "Програм ще немає",
    cascadeNote: "Разом з нею деактивуються її сервери й тарифи.",
  },
  servers: {
    tab: "Сервери",
    add: "Додати сервер",
    empty: "Серверів ще немає",
    cascadeNote: "Разом з ним деактивуються його тарифи.",
  },
  tariffs: { tab: "Тарифи", add: "Додати тариф", empty: "Тарифів ще немає" },
  addons: { tab: "Послуги", add: "Додати послугу", empty: "Додаткових послуг ще немає" },
  "tracker-models": { tab: "Моделі трекерів", add: "Додати модель", empty: "Моделей трекерів ще немає" },
  "sim-operators": {
    tab: "Оператори SIM",
    add: "Додати оператора",
    empty: "Операторів SIM ще немає",
    cascadeNote: "Разом з ним деактивуються його тарифи.",
  },
  "sim-plans": { tab: "Тарифи операторів", add: "Додати тариф оператора", empty: "Тарифів операторів ще немає" },
  contractors: { tab: "Підрядники", add: "Додати підрядника", empty: "Підрядників ще немає" },
  "disconnect-reasons": { tab: "Причини відключення", add: "Додати причину", empty: "Причин відключення ще немає" },
};
