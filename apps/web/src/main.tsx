import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Providers } from "./app/Providers";
import { reloadOnStaleChunk, reloadWhenRestoredFromHistory } from "./lib/stale-chunk";
import { ErrorBoundary } from "./ui";
import "./ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing in index.html");

reloadOnStaleChunk();
reloadWhenRestoredFromHistory();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <Providers>
        <App />
      </Providers>
    </ErrorBoundary>
  </StrictMode>,
);
