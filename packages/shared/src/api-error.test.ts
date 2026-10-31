import { describe, expect, it } from "vitest";
import { parseApiError } from "./api-error.ts";

describe("parseApiError", () => {
  it("reads the common format", () => {
    const body = { code: "code_taken", message: "Такий ID уже є", fieldErrors: { code: "Такий ID уже є" } };
    expect(parseApiError(body)).toEqual(body);
  });

  it("gives nothing for a body in another format", () => {
    expect(parseApiError("<html>Bad Gateway</html>")).toBeUndefined();
  });
});
