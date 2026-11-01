import {
  contractListSchema,
  contractNumberCheckSchema,
  createdReferenceSchema,
  type ContractNumberCheck,
  type ContractNumberCheckQuery,
} from "@gps_crm/shared";
import { API_BASE, apiGet, apiPost, apiSend, apiUpload } from "../../lib/api";
import type { Filters } from "../../lib/url-filters";
import { SUBSCRIBERS_KEY } from "../subscribers/subscribers.api";

// Under the clients: a contract changes what their cards show, and the refresh of a client has to reach it
export const CONTRACTS_KEY = [...SUBSCRIBERS_KEY, "contracts"];
export const clientContractsKey = (subscriberId: string) => [...CONTRACTS_KEY, "client", subscriberId];

export const CONTRACT_FILTER_KEYS = ["q", "status", "expiring", "signedFrom", "signedTo", "subscriberId"] as const;
export type ContractFilters = Filters<(typeof CONTRACT_FILTER_KEYS)[number]>;

export function contractListQuery(filters: ContractFilters, cursor: string | null): string {
  const params = new URLSearchParams(filters);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchContracts(filters: ContractFilters, cursor: string | null, signal: AbortSignal) {
  return apiGet(`/contracts${contractListQuery(filters, cursor)}`, contractListSchema, signal);
}

export function fetchClientContracts(subscriberId: string, signal: AbortSignal) {
  return apiGet(`/subscribers/${subscriberId}/contracts`, contractListSchema, signal);
}

export function checkContractNumber(
  query: ContractNumberCheckQuery,
  signal: AbortSignal,
): Promise<ContractNumberCheck> {
  const params = new URLSearchParams({ number: query.number, payerId: query.payerId });
  if (query.excludeId) params.set("excludeId", query.excludeId);
  return apiGet(`/contracts/number-check?${params.toString()}`, contractNumberCheckSchema, signal);
}

export function createContract(subscriberId: string, input: object) {
  return apiPost(`/subscribers/${subscriberId}/contracts`, createdReferenceSchema, input);
}

export function updateContract(id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/contracts/${id}`, input);
}

export function uploadContractFile(id: string, file: File): Promise<void> {
  return apiUpload(`/contracts/${id}/file`, file);
}

export function contractAction(id: string, action: "archive" | "restore"): Promise<void> {
  return apiSend("POST", `/contracts/${id}/${action}`);
}

// A plain link: the browser shows it in a new tab with the session it already has
export function contractFileUrl(id: string): string {
  return `${API_BASE}/contracts/${id}/file?disposition=inline`;
}
