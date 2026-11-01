const LAST_RELOAD_KEY = "stale-chunk-reload-at";
const RELOAD_GUARD_MS = 60_000;

// After a deploy an open tab asks for chunks of the old build, which are gone: one reload brings the new build.
// The guard stops a reload loop when the chunk is broken for another reason; the error then reaches ErrorBoundary.
export function reloadOnStaleChunk(): void {
  window.addEventListener("vite:preloadError", (event) => {
    const lastReloadAt = Number(sessionStorage.getItem(LAST_RELOAD_KEY));
    if (Date.now() - lastReloadAt < RELOAD_GUARD_MS) return;
    event.preventDefault();
    sessionStorage.setItem(LAST_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  });
}

// Back after signing out would otherwise bring the page and its data out of the browser's memory, on a shared computer
// too. A reload asks the server, and a session that is gone leads to the sign-in.
export function reloadWhenRestoredFromHistory(): void {
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });
}
