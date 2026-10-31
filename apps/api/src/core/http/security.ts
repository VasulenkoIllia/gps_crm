import helmet from "@fastify/helmet";
import type { FastifyInstance } from "fastify";

// antd puts its generated styles into <style> tags and style attributes, so style-src needs 'unsafe-inline'.
// HTTPS and HSTS are Traefik's job, so upgrade-insecure-requests stays off: it would break plain http on localhost.
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
}
