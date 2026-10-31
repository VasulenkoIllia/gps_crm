import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function captureLogs(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { lines, stream };
}

describe("createLogger", () => {
  it("writes JSON with the secrets masked", () => {
    const { lines, stream } = captureLogs();
    const logger = createLogger("info", stream);

    logger.info({ password: "p1", user: { token: "t1", name: "Olena" } }, "signed in");

    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      msg: "signed in",
      password: "[redacted]",
      user: { token: "[redacted]", name: "Olena" },
    });
  });
});
