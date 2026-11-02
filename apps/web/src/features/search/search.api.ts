import {
  formatPhone,
  searchResultSchema,
  type ClientHit,
  type ContactHit,
  type DeviceHit,
  type ObjectHit,
  type SearchResult,
  type SimHit,
} from "@gps_crm/shared";
import { apiGet } from "../../lib/api";
import { queryOf } from "../subscribers/subscribers.api";

export const SEARCH_KEY = ["search"];

export function fetchSearch(q: string, withArchive: boolean, signal: AbortSignal): Promise<SearchResult> {
  return apiGet(`/search${queryOf({ q, archived: withArchive ? "true" : undefined })}`, searchResultSchema, signal);
}

export interface SearchLine {
  key: string;
  to: string;
  title: string;
  meta: string | null;
  isArchived: boolean;
}

export interface SearchSection {
  key: keyof SearchResult;
  title: string;
  lines: SearchLine[];
  // The list behind «Показати всі», with the same query in it; none for contacts, which have no list of their own
  moreTo: string | null;
}

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ") || null;

// search-exports.md П3: each line leads to the card of its record. A tracker and a SIM have no page of their own: the
// line opens the object they stand on, or the stock list found by the number.
const LINES = {
  clients: (row: ClientHit): SearchLine => ({
    key: row.id,
    to: `/subscribers/${row.id}`,
    title: `${row.code} ${row.name}`,
    meta: join(row.legacyCode && `старий номер ${row.legacyCode}`, row.taxId),
    isArchived: row.isArchived,
  }),
  contacts: (row: ContactHit): SearchLine => ({
    key: row.id,
    to: `/subscribers/${row.subscriberId}?tab=contacts`,
    title: row.fullName,
    meta: join(formatPhone(row.phone), `${row.subscriberCode} ${row.subscriberName}`),
    isArchived: row.isArchived,
  }),
  objects: (row: ObjectHit): SearchLine => ({
    key: row.id,
    to: `/objects/${row.id}`,
    title: row.name,
    meta: join(`${row.subscriberCode} ${row.subscriberName}`, row.imei && `IMEI ${row.imei}`),
    isArchived: row.isArchived,
  }),
  devices: (row: DeviceHit): SearchLine => ({
    key: row.id,
    to: row.objectId ? `/objects/${row.objectId}` : `/equipment${queryOf({ tab: "devices", q: row.imei })}`,
    title: `IMEI ${row.imei}`,
    meta: join(row.modelName, row.objectName ?? "не встановлений"),
    isArchived: row.isArchived,
  }),
  sims: (row: SimHit): SearchLine => ({
    key: row.id,
    to: row.objectId ? `/objects/${row.objectId}` : `/equipment${queryOf({ tab: "sims", q: row.iccid })}`,
    title: `ICCID ${row.iccid}`,
    meta: join(row.msisdn, row.objectName ?? "не встановлена"),
    isArchived: row.isArchived,
  }),
};

const TITLES: Record<keyof SearchResult, string> = {
  clients: "Клієнти",
  contacts: "Контакти",
  objects: "Об'єкти",
  devices: "Трекери",
  sims: "SIM-картки",
};

// The live list: it holds either the live records or the archive, and the live ones come first in a group too
function moreOf(key: keyof SearchResult, q: string): string | null {
  if (key === "clients") return `/subscribers${queryOf({ q })}`;
  if (key === "objects") return `/objects${queryOf({ q })}`;
  if (key === "devices" || key === "sims") return `/equipment${queryOf({ tab: key, q })}`;
  return null;
}

// The groups in the order of the screen, those that were searched at all
export function sectionsOf(result: SearchResult, q: string): SearchSection[] {
  const sections: SearchSection[] = [];
  const add = <T>(
    key: keyof SearchResult,
    group: { items: T[]; hasMore: boolean } | null,
    line: (row: T) => SearchLine,
  ) => {
    if (!group) return;
    sections.push({
      key,
      title: TITLES[key],
      lines: group.items.map(line),
      moreTo: group.hasMore ? moreOf(key, q) : null,
    });
  };
  add("clients", result.clients, LINES.clients);
  add("contacts", result.contacts, LINES.contacts);
  add("objects", result.objects, LINES.objects);
  add("devices", result.devices, LINES.devices);
  add("sims", result.sims, LINES.sims);
  return sections;
}
