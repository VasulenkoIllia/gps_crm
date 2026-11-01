import { describe, expect, it } from "vitest";
import { describeJobError } from "./run-job.js";

describe("describeJobError", () => {
  it("keeps the kind and the code of a Prisma error and never its text, which quotes the query", () => {
    const error = Object.assign(new Error("Invalid value `+380671234567`"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
    });
    expect(describeJobError(error)).toBe("PrismaClientKnownRequestError P2002");
  });

  it("cuts a long message", () => {
    expect(describeJobError(new Error("x".repeat(2_000))).length).toBeLessThanOrEqual(500);
  });

  it("has an answer for something that is not an error", () => {
    expect(describeJobError("just a string")).toBe("Unknown error");
  });
});
