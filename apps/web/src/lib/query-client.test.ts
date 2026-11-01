import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { isSessionLost, shouldRetry } from "./query-client";

describe("shouldRetry", () => {
  it("does not repeat a 4xx", () => {
    expect(shouldRetry(0, new ApiError(404, "not_found", "Не знайдено"))).toBe(false);
  });

  it("repeats a failed server once", () => {
    const failure = new ApiError(502, "unexpected_response", "Сталася помилка");
    expect(shouldRetry(0, failure)).toBe(true);
    expect(shouldRetry(1, failure)).toBe(false);
  });
});

describe("isSessionLost", () => {
  it("knows a lost session", () => {
    expect(isSessionLost(new ApiError(401, "unauthorized", "Потрібно увійти"))).toBe(true);
  });

  it.each([
    [401, "invalid_credentials"],
    [401, "invalid_code"],
    [403, "forbidden"],
  ])("leaves %i %s to the form", (status, code) => {
    expect(isSessionLost(new ApiError(status, code, "Текст"))).toBe(false);
  });

  it("is not confused by a network failure", () => {
    expect(isSessionLost(new TypeError("Failed to fetch"))).toBe(false);
  });
});
