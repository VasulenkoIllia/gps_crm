import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { stopApp } from "./shutdown.js";

const SLOW_REQUEST_MS = 200;
const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

describe("stopApp", () => {
  it("finishes a request in flight before it closes the dependencies", async () => {
    const events: string[] = [];
    const app = Fastify();
    app.get("/slow", async () => {
      await wait(SLOW_REQUEST_MS);
      events.push("request finished");
      return { ok: true };
    });
    const url = await app.listen({ host: "127.0.0.1", port: 0 });

    const response = fetch(`${url}/slow`);
    await wait(SLOW_REQUEST_MS / 4);
    await stopApp(app, () => {
      events.push("dependencies closed");
      return Promise.resolve();
    });

    expect((await response).status).toBe(200);
    expect(events).toEqual(["request finished", "dependencies closed"]);
  });
});
