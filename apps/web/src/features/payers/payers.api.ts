import { payerListSchema } from "@gps_crm/shared";
import { apiGet } from "../../lib/api";
import type { Filters } from "../../lib/url-filters";
import { queryOf, SUBSCRIBERS_KEY } from "../subscribers/subscribers.api";

// Under the clients: a payer changes in the card of a client, and the refresh of a client has to reach this list
export const PAYERS_LIST_KEY = [...SUBSCRIBERS_KEY, "payers", "list"];

export const PAYER_FILTER_KEYS = ["q"] as const;
export type PayerFilters = Filters<(typeof PAYER_FILTER_KEYS)[number]>;

const PAGE_SIZE = 50;

// D90: the same search as «Прив'язати наявного» uses, here page by page: name from three letters, a code by its start (D84)
export function fetchPayerPage(filters: PayerFilters, cursor: string | null, signal: AbortSignal) {
  const query = queryOf({ q: filters.q, cursor, limit: String(PAGE_SIZE) });
  return apiGet(`/payers${query}`, payerListSchema, signal);
}
