import { useEffect, useState } from "react";

export const SEARCH_DELAY_MS = 300;

// A value that follows the original once it stops changing: a search asks the server for words, not for every letter
export function useDebouncedValue<T>(value: T, delayMs = SEARCH_DELAY_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}
