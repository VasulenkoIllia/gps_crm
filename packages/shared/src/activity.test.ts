import { describe, expect, it } from "vitest";
import {
  activityActionLabel,
  activityFieldLabel,
  activityListQuerySchema,
  decodeActivityCursor,
  encodeActivityCursor,
} from "./activity.ts";

const ID = "0192f3f0-0000-7000-8000-000000000001";
const AT = "2026-11-01T10:00:00.123456Z";

describe("the journal cursor", () => {
  it("survives the way there and back with its microseconds", () => {
    const cursor = encodeActivityCursor({ occurredAt: AT, id: ID });
    expect(activityListQuerySchema.parse({ cursor }).cursor).toBe(cursor);
    expect(decodeActivityCursor(cursor)).toEqual({ occurredAt: AT, id: ID });
  });

  it.each([
    "abc",
    `${AT}_`,
    `2026-11-01T10:00:00Z_${ID}`,
    `${AT}_${ID}'; DROP TABLE users`,
    `2026-13-45T25:61:61.000000Z_${ID}`,
    `2026-02-30T10:00:00.000000Z_${ID}`,
    `0000-01-01T00:00:00.000000Z_${ID}`,
    `${AT}_------------------------------------`,
  ])("refuses %s", (cursor) => {
    expect(activityListQuerySchema.safeParse({ cursor }).success).toBe(false);
  });
});

describe("the journal filters", () => {
  it("refuses a period that ends before it starts", () => {
    const result = activityListQuerySchema.safeParse({ from: "2026-11-02T00:00:00Z", to: "2026-11-01T00:00:00Z" });
    expect(result.success).toBe(false);
  });

  it("refuses a year the database has no such thing as", () => {
    expect(activityListQuerySchema.safeParse({ from: "0000-01-01T00:00:00Z" }).success).toBe(false);
  });

  it("refuses an action that does not exist and a key it does not know", () => {
    expect(activityListQuerySchema.safeParse({ action: "user.deleted_everything" }).success).toBe(false);
    expect(activityListQuerySchema.safeParse({ sort: "ip" }).success).toBe(false);
  });

  it("caps the page", () => {
    expect(activityListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(activityListQuerySchema.parse({}).limit).toBe(50);
  });
});

describe("labels", () => {
  it("names a known action and field, and shows an unknown one as it is", () => {
    expect(activityActionLabel("user.blocked")).toBe("Блокування");
    expect(activityActionLabel("something.new")).toBe("something.new");
    expect(activityFieldLabel("fullName")).toBe("ПІБ");
    expect(activityFieldLabel("newField")).toBe("newField");
  });
});
