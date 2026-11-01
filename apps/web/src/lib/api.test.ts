import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiFetch, apiGet, apiPost, apiSend, fetchReadiness } from "./api";

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

describe("fetchReadiness", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok from a 200", async () => {
    stubFetch(200, { status: "ok" });
    await expect(fetchReadiness()).resolves.toEqual({ status: "ok" });
  });

  it("treats a 503 with the contract body as a state, not a failure", async () => {
    stubFetch(503, { status: "unavailable" });
    await expect(fetchReadiness()).resolves.toEqual({ status: "unavailable" });
  });

  it("fails on another status", async () => {
    stubFetch(502, { status: "ok" });
    await expect(fetchReadiness()).rejects.toMatchObject({ status: 502 });
  });

  it("fails on a broken body", async () => {
    stubFetch(200, { status: "maybe" });
    await expect(fetchReadiness()).rejects.toThrow();
  });
});

describe("apiFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns the common error format into an ApiError", async () => {
    stubFetch(409, { code: "code_taken", message: "Такий ID уже є", fieldErrors: { code: "Такий ID уже є" } });
    const error = await apiFetch("/api/v1/subscribers").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "code_taken", fieldErrors: { code: "Такий ID уже є" } });
  });

  it("survives a page from a proxy instead of the format", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("<html>Bad Gateway</html>", { status: 502 })));
    await expect(apiFetch("/api/v1/subscribers")).rejects.toMatchObject({ status: 502, code: "unexpected_response" });
  });

  it("passes a good response through", async () => {
    stubFetch(200, { id: 1 });
    expect((await apiFetch("/api/v1/subscribers")).status).toBe(200);
  });
});

describe("JSON requests", () => {
  const schema = z.strictObject({ id: z.number() });

  afterEach(() => vi.unstubAllGlobals());

  it("checks the answer against the contract", async () => {
    stubFetch(200, { id: 1 });
    await expect(apiGet("/me", schema)).resolves.toEqual({ id: 1 });
    stubFetch(200, { id: "1" });
    await expect(apiGet("/me", schema)).rejects.toThrow();
  });

  it("declares JSON only when there is a body", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", (_: string, init: RequestInit) => {
      calls.push(init);
      return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    });

    await apiPost("/me/2fa/setup", schema);
    await apiSend("PATCH", "/me", { fullName: "Олена" });

    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0]?.headers).toBeUndefined();
    expect(calls[1]).toMatchObject({ method: "PATCH", body: '{"fullName":"Олена"}' });
    expect(calls[1]?.headers).toEqual({ "content-type": "application/json" });
  });
});
