import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const USER = process.env.BASIC_AUTH_USER;
const PASSWORD = process.env.BASIC_AUTH_PASSWORD;

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Optional HTTP Basic auth for the public demo. Disabled unless both
 * BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set. Returns true when the request may proceed.
 */
export function checkBasicAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!USER || !PASSWORD) return true;

  const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep > 0 && safeEqual(decoded.slice(0, sep), USER) && safeEqual(decoded.slice(sep + 1), PASSWORD)) {
      return true;
    }
  }

  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="gps_crm", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
  });
  res.end("Authorization required");
  return false;
}
