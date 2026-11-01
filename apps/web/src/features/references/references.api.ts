import {
  addonListSchema,
  createdReferenceSchema,
  REFERENCE_PAGE_MAX,
  serverListSchema,
  simpleReferenceListSchema,
  simPlanListSchema,
  tariffListSchema,
  type Addon,
  type CostPriceInput,
  type CreatedReference,
  type DatedPrice,
  type ReferenceKind,
  type Server,
  type SimpleReference,
  type SimPlan,
  type Tariff,
  type TariffVersionInput,
} from "@gps_crm/shared";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiGet, apiPost, apiSend } from "../../lib/api";
import { ACTIVITY_KEY, ARCHIVE_KEY } from "../activity/activity.api";

export const REFERENCES_KEY = ["references"];

// A change of a reference is also a line of the journal, and a deactivation a package of the archive
export function refreshAfterChange(client: QueryClient): void {
  for (const queryKey of [REFERENCES_KEY, ACTIVITY_KEY, ARCHIVE_KEY]) void client.invalidateQueries({ queryKey });
}

interface ReferenceRows {
  programs: SimpleReference;
  servers: Server;
  tariffs: Tariff;
  addons: Addon;
  "tracker-models": SimpleReference;
  "sim-operators": SimpleReference;
  "sim-plans": SimPlan;
  contractors: SimpleReference;
  "disconnect-reasons": SimpleReference;
}

export type ReferenceItem<K extends ReferenceKind> = ReferenceRows[K];

interface ReferencePage<K extends ReferenceKind> {
  items: ReferenceItem<K>[];
  nextCursor: string | null;
}

const LIST_SCHEMAS: { [K in ReferenceKind]: { parse: (value: unknown) => ReferencePage<K> } } = {
  programs: simpleReferenceListSchema,
  servers: serverListSchema,
  tariffs: tariffListSchema,
  addons: addonListSchema,
  "tracker-models": simpleReferenceListSchema,
  "sim-operators": simpleReferenceListSchema,
  "sim-plans": simPlanListSchema,
  contractors: simpleReferenceListSchema,
  "disconnect-reasons": simpleReferenceListSchema,
};

interface PageParams {
  status?: string;
  cursor?: string | null;
  limit?: number;
}

export function referenceListQuery({ status, cursor, limit }: PageParams): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function fetchReferencePage<K extends ReferenceKind>(kind: K, params: PageParams, signal: AbortSignal) {
  return apiGet(`/references/${kind}${referenceListQuery(params)}`, LIST_SCHEMAS[kind], signal);
}

// Past the size of a page too: tariffs pile up, one per price, and a form cannot be left without the newest of them
async function fetchWholeList<K extends ReferenceKind>(kind: K, signal: AbortSignal): Promise<ReferenceItem<K>[]> {
  const rows: ReferenceItem<K>[] = [];
  let cursor: string | null = null;
  do {
    const page: ReferencePage<K> = await fetchReferencePage(kind, { cursor, limit: REFERENCE_PAGE_MAX }, signal);
    rows.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return rows;
}

// Only a form that is open needs a list
export function useReferenceOptions<K extends ReferenceKind>(kind: K, isEnabled: boolean) {
  const list = useQuery({
    queryKey: [...REFERENCES_KEY, kind, "options"],
    queryFn: ({ signal }) => fetchWholeList(kind, signal),
    enabled: isEnabled,
  });
  const items = list.data;
  const options = useMemo(
    () => (items ?? []).map(({ id, name, isActive }) => ({ value: id, label: name, isActive })),
    [items],
  );
  // A failed refresh of a list already here is no failure for the person choosing from it
  return { items, options, isLoading: list.isPending, hasError: list.isError && !items };
}

export function createReference(kind: ReferenceKind, input: object): Promise<CreatedReference> {
  return apiPost(`/references/${kind}`, createdReferenceSchema, input);
}

export function updateReference(kind: ReferenceKind, id: string, input: object): Promise<void> {
  return apiSend("PATCH", `/references/${kind}/${id}`, input);
}

export function deactivateReference(kind: ReferenceKind, id: string): Promise<void> {
  return apiSend("POST", `/references/${kind}/${id}/deactivate`);
}

export function createTariffVersion(id: string, input: TariffVersionInput): Promise<CreatedReference> {
  return apiPost(`/references/tariffs/${id}/new-version`, createdReferenceSchema, input);
}

export function addAddonPrice(id: string, input: DatedPrice): Promise<void> {
  return apiSend("POST", `/references/addons/${id}/prices`, input);
}

export function addCostPrice(input: CostPriceInput): Promise<void> {
  return apiSend("POST", "/references/cost-prices", input);
}
