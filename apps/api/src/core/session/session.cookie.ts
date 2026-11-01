import type {} from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";

// __Host- makes the browser refuse the cookie from any subdomain: other projects live under the same parent domain
const SECURE_NAME = "__Host-session";
// __Host- needs Secure, and local development runs over plain http
const LOCAL_NAME = "session";
const MS_PER_SECOND = 1_000;

function cookieName(isSecure: boolean): string {
  return isSecure ? SECURE_NAME : LOCAL_NAME;
}

export function readSessionToken(request: FastifyRequest, isSecure: boolean): string | undefined {
  return request.cookies[cookieName(isSecure)];
}

// The cookie lives to the absolute limit, the idle limit is the server's to enforce (П6)
export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, isSecure: boolean): void {
  reply.setCookie(cookieName(isSecure), token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor((expiresAt.getTime() - Date.now()) / MS_PER_SECOND),
  });
}

export function clearSessionCookie(reply: FastifyReply, isSecure: boolean): void {
  reply.clearCookie(cookieName(isSecure), { httpOnly: true, secure: isSecure, sameSite: "lax", path: "/" });
}
