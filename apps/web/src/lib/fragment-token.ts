import { useEffect, useState } from "react";

export function readFragmentToken(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, "")).get("token");
}

// Links carry the token after #, which never reaches a server or a log; the address bar is cleared so it does not stay
// in the history either
export function useFragmentToken(): string | null {
  const [token] = useState(() => readFragmentToken(window.location.hash));
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return token;
}
