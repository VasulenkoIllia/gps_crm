import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

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
