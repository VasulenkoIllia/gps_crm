import { relative, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

const API_PATH = /^\/api(?:\/|$)/;
// A missing file (/assets/app.js) gets a 404, never the HTML page; so does a client route whose last part has a dot
const FILE_PATH = /\/[^/]+\.[a-z0-9]+$/i;
const IMMUTABLE = "public, max-age=31536000, immutable";

// A browser route of the web app: GET or HEAD outside /api, without a file extension (the query is left out)
export function isSpaRoute(method: string, url: string): boolean {
  const path = url.split("?", 1)[0] ?? url;
  return (method === "GET" || method === "HEAD") && !API_PATH.test(path) && !FILE_PATH.test(path);
}

export async function registerSpa(app: FastifyInstance, webRoot: string): Promise<void> {
  await app.register(fastifyStatic, {
    root: webRoot,
    // Hidden files (a .DS_Store copied from public/, editor files) are never served
    dotfiles: "ignore",
    // Vite names files in assets/ by content hash, so they never change under the same name
    setHeaders: (reply, filePath) => {
      if (relative(webRoot, filePath).startsWith(`assets${sep}`)) reply.header("cache-control", IMMUTABLE);
    },
  });
}
