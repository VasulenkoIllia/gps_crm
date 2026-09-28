import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const ROOT = path.resolve(process.env.STATIC_DIR || "dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function fileStat(p: string) {
  try {
    return fs.statSync(p);
  } catch {
    return undefined;
  }
}

/** Serves the built SPA from `dist/`; unknown extension-less paths fall back to index.html. */
export function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  } catch {
    return false;
  }

  const requested = path.resolve(ROOT, `.${pathname}`);
  if (requested !== ROOT && !requested.startsWith(ROOT + path.sep)) return false;

  let target = requested;
  const stat = fileStat(target);
  if (!stat || stat.isDirectory()) {
    if (path.extname(pathname)) return false;
    target = path.join(ROOT, "index.html");
    if (!fileStat(target)) return false;
  }

  const immutable = pathname.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": CONTENT_TYPES[path.extname(target)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "X-Robots-Tag": "noindex, nofollow",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(target).pipe(res);
  return true;
}
