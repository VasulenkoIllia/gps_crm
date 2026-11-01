import { describe, expect, it } from "vitest";
import { decodeListCursor, encodeListCursor, listCursorSchema } from "./list-cursor.ts";

const ID = "019a0000-0000-7000-8000-000000000001";

describe("list cursor", () => {
  it("survives a value with the separator in it", () => {
    const cursor = { value: "ТОВ_Обрій_2", id: ID };
    expect(decodeListCursor(encodeListCursor(cursor))).toEqual(cursor);
  });

  it("takes an empty value", () => {
    expect(decodeListCursor(`_${ID}`)).toEqual({ value: "", id: ID });
  });

  it.each(["abc", `Обрій-${ID}`, `Обрій_${ID.slice(1)}`, `${"я".repeat(800)}_${ID}`])("refuses %s", (cursor) => {
    expect(listCursorSchema.safeParse(cursor).success).toBe(false);
  });
});
