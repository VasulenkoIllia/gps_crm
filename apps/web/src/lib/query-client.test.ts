import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { shouldRetry } from "./query-client";

describe("shouldRetry", () => {
  it("does not repeat a 4xx", () => {
    expect(shouldRetry(0, new ApiError(404, "not_found", "Не знайдено"))).toBe(false);
  });

  it("repeats a server error once", () => {
    const error = new ApiError(502, "unexpected_response", "Помилка");
    expect(shouldRetry(0, error)).toBe(true);
    expect(shouldRetry(1, error)).toBe(false);
  });

  it("repeats a network failure once", () => {
    expect(shouldRetry(0, new TypeError("Failed to fetch"))).toBe(true);
  });
});
