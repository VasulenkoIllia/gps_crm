// While a new filter loads, the rows of the old one stay in place. An old empty result does not: it would claim there is
// nothing at all before anyone has looked, so the list waits as it does on the first load.
export function listRows<T>(data: { pages: { items: T[] }[] } | undefined, isPlaceholder: boolean): T[] | undefined {
  const rows = data?.pages.flatMap((page) => page.items);
  return isPlaceholder && rows?.length === 0 ? undefined : rows;
}
