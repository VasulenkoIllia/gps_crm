import { SORT_ORDERS, type SortOrder } from "@gps_crm/shared";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

const SORT_PARAM = "sort";
const ORDER_PARAM = "order";

export type Filters<K extends string> = Partial<Record<K, string>>;

export function readFilters<K extends string>(params: URLSearchParams, keys: readonly K[]): Filters<K> {
  const filters: Filters<K> = {};
  for (const key of keys) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  return filters;
}

export function withFilter(params: URLSearchParams, key: string, value: string | undefined): URLSearchParams {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

// In the address, so a filtered list survives a reload and can be sent to a colleague (05-ui-standard.md §5.2).
// replace: Back leaves the list instead of walking through every filter.
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params, keys), [params, keys]);
  const setFilter = useCallback(
    (key: K, value: string | undefined) => {
      setParams((current) => withFilter(current, key, value), { replace: true });
    },
    [setParams],
  );
  // Only its own keys: a tab or a sort in the same address is not a filter
  const resetFilters = useCallback(() => {
    setParams((current) => keys.reduce((next, key) => withFilter(next, key, undefined), current), { replace: true });
  }, [keys, setParams]);
  return { filters, hasFilters: Object.keys(filters).length > 0, setFilter, resetFilters };
}

interface UrlSort {
  key: string;
  order: SortOrder;
}

export function readSort<K extends string>(params: URLSearchParams, keys: readonly K[]): UrlSort | undefined {
  const key = keys.find((sort) => sort === params.get(SORT_PARAM));
  const order = SORT_ORDERS.find((value: SortOrder) => value === params.get(ORDER_PARAM)) ?? "asc";
  return key ? { key, order } : undefined;
}

// As the filters: a sorted list survives a reload, and Back leaves the list
export function useUrlSort<K extends string>(keys: readonly K[]) {
  const [params, setParams] = useSearchParams();
  const sort = useMemo(() => readSort(params, keys), [params, keys]);
  const applySort = useCallback(
    (next: UrlSort | null) => {
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          updated.delete(SORT_PARAM);
          updated.delete(ORDER_PARAM);
          if (next) {
            updated.set(SORT_PARAM, next.key);
            updated.set(ORDER_PARAM, next.order);
          }
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return { sort, applySort };
}
