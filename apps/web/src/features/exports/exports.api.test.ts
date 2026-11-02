import type { ExportJob } from "@gps_crm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportFileUrl, waitForExport } from "./exports.api";

const job = (status: ExportJob["status"]): ExportJob => ({
  id: "e1",
  entity: "subscribers",
  status,
  rowCount: status === "done" ? 3 : null,
  error: null,
  createdAt: "2026-11-02T10:00:00.000Z",
  finishedAt: null,
  expiresAt: null,
});

function answer(body: ExportJob): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("waitForExport", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks until the export is finished", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(answer(job("running")))
      .mockResolvedValueOnce(answer(job("done")));
    vi.stubGlobal("fetch", fetchMock);

    const waiting = waitForExport(job("queued"));
    await vi.runAllTimersAsync();

    expect(await waiting).toMatchObject({ status: "done", rowCount: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops asking after a minute without the server", async () => {
    let clock = 0;
    const later = () => {
      clock += 20_000;
      return clock;
    };
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const lost = expect(waitForExport(job("queued"), later)).rejects.toThrow("Немає зв'язку з сервером");
    await vi.runAllTimersAsync();
    await lost;
  });

  it("asks again after a failure of the network, and not after an answer about the export", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("", { status: 502 }))
      .mockResolvedValueOnce(answer(job("done")));
    vi.stubGlobal("fetch", fetchMock);

    const waiting = waitForExport(job("queued"));
    await vi.runAllTimersAsync();
    expect(await waiting).toMatchObject({ status: "done" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    const gone = expect(waitForExport(job("queued"))).rejects.toMatchObject({ status: 404 });
    await vi.runAllTimersAsync();
    await gone;
  });

  it("gives up after the time a run has on the server", async () => {
    let clock = 0;
    const later = () => {
      clock += 31 * 60 * 1_000;
      return clock;
    };

    await expect(waitForExport(job("queued"), later)).rejects.toThrow("надто довго");
  });

  it("returns a finished one at once", async () => {
    expect(await waitForExport(job("failed"))).toMatchObject({ status: "failed" });
  });

  it("downloads the file from the API", () => {
    expect(exportFileUrl("e1")).toBe("/api/v1/exports/e1/file");
  });
});
