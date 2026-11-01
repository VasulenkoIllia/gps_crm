import {
  activityListSchema,
  contactListSchema,
  createdSubscriberSchema,
  duplicateListSchema,
  managerListSchema,
  payerListSchema,
  subscriberCardSchema,
  subscriberCodeCheckSchema,
  subscriberCountSchema,
  subscriberListSchema,
  type ActivityList,
  type CreatedSubscriber,
  type DuplicateList,
  type DuplicatesQuery,
  type SubscriberCodeCheck,
} from "@gps_crm/shared";
import type { QueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiSend } from "../../lib/api";
import type { Filters } from "../../lib/url-filters";
import { REMOTE_SELECT_KEY } from "../../lib/query-client";
import type { RemoteOption } from "../../ui";
import { ACTIVITY_KEY, ARCHIVE_KEY } from "../activity/activity.api";
import { REFERENCES_KEY } from "../references/references.api";

// The root of everything about clients: a change of a contact or a contract also changes what the card and the lists show
export const SUBSCRIBERS_KEY = ["subscribers"];
export const MANAGERS_KEY = [...SUBSCRIBERS_KEY, "managers"];
export const subscriberKey = (id: string) => [...SUBSCRIBERS_KEY, "card", id];
export const contactsKey = (id: string) => [...SUBSCRIBERS_KEY, "contacts", id];
export const payersKey = (id: string) => [...SUBSCRIBERS_KEY, "payers", id];

const SEARCH_LIMIT = 20;

export const SUBSCRIBER_FILTER_KEYS = [
  "q",
  "status",
  "type",
  "programId",
  "tariffId",
  "managerId",
  "archived",
] as const;
export type SubscriberFilters = Filters<(typeof SUBSCRIBER_FILTER_KEYS)[number]>;

// A change of a client is also a line of the journal, a number on the tab of tariffs, and maybe a package of the archive
export function refreshClients(client: QueryClient): void {
  for (const queryKey of [SUBSCRIBERS_KEY, REFERENCES_KEY, ACTIVITY_KEY, ARCHIVE_KEY, REMOTE_SELECT_KEY]) {
    void client.invalidateQueries({ queryKey });
  }
}

function queryOf(values: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export interface SubscriberPageParams {
  filters: SubscriberFilters;
  sort?: string;
  order?: string;
  cursor: string | null;
}

export function fetchSubscribers({ filters, sort, order, cursor }: SubscriberPageParams, signal: AbortSignal) {
  const query = queryOf({ ...filters, sort, order, cursor });
  return apiGet(`/subscribers${query}`, subscriberListSchema, signal);
}

export function fetchSubscriberCount(filters: SubscriberFilters, signal: AbortSignal) {
  return apiGet(`/subscribers/count${queryOf(filters)}`, subscriberCountSchema, signal);
}

export function fetchSubscriber(id: string, signal: AbortSignal) {
  return apiGet(`/subscribers/${id}`, subscriberCardSchema, signal);
}

export async function searchSubscribers(text: string, signal: AbortSignal): Promise<RemoteOption[]> {
  const query = queryOf({ q: text, limit: String(SEARCH_LIMIT) });
  const { items } = await apiGet(`/subscribers${query}`, subscriberListSchema, signal);
  return items.map(({ id, code, name }) => ({ value: id, label: `${code} ${name}` }));
}

export function fetchManagers(signal: AbortSignal) {
  return apiGet("/subscribers/managers", managerListSchema, signal);
}

export function fetchDuplicates(query: DuplicatesQuery, signal: AbortSignal): Promise<DuplicateList> {
  return apiGet(`/subscribers/duplicates${queryOf({ ...query })}`, duplicateListSchema, signal);
}

export function checkCode(code: string, excludeId: string, signal: AbortSignal): Promise<SubscriberCodeCheck> {
  return apiGet(`/subscribers/code-check${queryOf({ code, excludeId })}`, subscriberCodeCheckSchema, signal);
}

export function createSubscriber(input: object): Promise<CreatedSubscriber> {
  return apiPost("/subscribers", createdSubscriberSchema, input);
}

export function updateSubscriber(id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/subscribers/${id}`, input);
}

export function changeTariff(id: string, input: object): Promise<void> {
  return apiSend("POST", `/subscribers/${id}/tariff`, input);
}

export function changeCode(id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/subscribers/${id}/code`, input);
}

export function archiveSubscriber(id: string): Promise<void> {
  return apiSend("POST", `/subscribers/${id}/archive`);
}

export function restoreSubscriber(id: string): Promise<void> {
  return apiSend("POST", `/subscribers/${id}/restore`);
}

export function deleteSubscriber(id: string): Promise<void> {
  return apiSend("DELETE", `/subscribers/${id}`);
}

export function fetchClientActivity(id: string, cursor: string | null, signal: AbortSignal): Promise<ActivityList> {
  return apiGet(`/subscribers/${id}/activity${queryOf({ cursor })}`, activityListSchema, signal);
}

export function fetchContacts(id: string, signal: AbortSignal) {
  return apiGet(`/subscribers/${id}/contacts`, contactListSchema, signal);
}

export function createContact(subscriberId: string, input: object): Promise<void> {
  return apiSend("POST", `/subscribers/${subscriberId}/contacts`, input);
}

export function updateContact(id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/contacts/${id}`, input);
}

export function contactAction(id: string, action: "make-primary" | "archive" | "restore"): Promise<void> {
  return apiSend("POST", `/contacts/${id}/${action}`);
}

export function deleteContact(id: string): Promise<void> {
  return apiSend("DELETE", `/contacts/${id}`);
}

export function fetchPayers(id: string, signal: AbortSignal) {
  return apiGet(`/subscribers/${id}/payers`, payerListSchema, signal);
}

export function searchPayers(text: string, signal: AbortSignal) {
  return apiGet(`/payers${queryOf({ q: text, limit: String(SEARCH_LIMIT) })}`, payerListSchema, signal);
}

export async function searchPayerOptions(text: string, signal: AbortSignal): Promise<RemoteOption[]> {
  const { items } = await searchPayers(text, signal);
  return items.map(({ id, name, taxId }) => ({ value: id, label: taxId ? `${name}, ${taxId}` : name }));
}

export function createPayer(subscriberId: string, input: object): Promise<void> {
  return apiSend("POST", `/subscribers/${subscriberId}/payers`, input);
}

export function updatePayer(id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/payers/${id}`, input);
}

export function linkPayer(subscriberId: string, payerId: string): Promise<void> {
  return apiSend("POST", `/subscribers/${subscriberId}/payers/${payerId}/link`);
}

export function unlinkPayer(subscriberId: string, payerId: string): Promise<void> {
  return apiSend("DELETE", `/subscribers/${subscriberId}/payers/${payerId}/link`);
}

export function payerAction(id: string, action: "archive" | "restore"): Promise<void> {
  return apiSend("POST", `/payers/${id}/${action}`);
}
