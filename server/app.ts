import http from "node:http";
import { handleRoutes } from "./routes/index.js";
import { checkBasicAuth } from "./auth.js";
import { serveStatic } from "./static.js";

export function createApp() {
  return http.createServer((req, res) => {
    // Health check stays open so Docker / Traefik can probe it without credentials.
    if (handleRoutes(req, res)) {
      return;
    }

    if (!checkBasicAuth(req, res)) {
      return;
    }

    if (serveStatic(req, res)) {
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
  });
}
