import { PassThrough } from "node:stream";
import { buffer } from "node:stream/consumers";
import { EXPORT_ROWS_MAX } from "@gps_crm/shared";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { Cell } from "./exports.columns.js";
import { ExportRefused, writeWorkbook, type Sheet } from "./exports.workbook.js";

async function* pages(...list: Cell[][][]) {
  for (const page of list) yield await Promise.resolve(page);
}

const columns = [
  { header: "Назва", width: 20 },
  { header: "Дата", width: 12, isDate: true },
];

describe("the workbook of an export", () => {
  it("writes the header, the rows and the dates as dates", async () => {
    const out = new PassThrough();
    const content = buffer(out);
    const sheet: Sheet = {
      name: "Об'єкти",
      columns,
      pages: pages([["Перший", new Date("2026-11-02T00:00:00Z")]], [["Другий", null]]),
    };

    expect(await writeWorkbook(out, sheet, new AbortController().signal)).toBe(2);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await content) as unknown as ArrayBuffer);
    const [worksheet] = workbook.worksheets;
    expect(worksheet?.name).toBe("Об'єкти");
    expect(worksheet?.getRow(1).values).toEqual([undefined, "Назва", "Дата"]);
    expect(worksheet?.getCell("B2").numFmt).toBe("dd.mm.yyyy");
    expect(worksheet?.getCell("A3").value).toBe("Другий");
  });

  it("refuses a list longer than a sheet of Excel before writing it", async () => {
    const tooLong = Array.from({ length: EXPORT_ROWS_MAX + 1 }, (): Cell[] => []);
    const sheet: Sheet = { name: "Трекери", columns, pages: pages(tooLong) };

    await expect(writeWorkbook(new PassThrough(), sheet, new AbortController().signal)).rejects.toBeInstanceOf(
      ExportRefused,
    );
  });

  it("stops between the pages once the run is given up", async () => {
    const controller = new AbortController();
    controller.abort();
    const sheet: Sheet = { name: "Трекери", columns, pages: pages([["Перший", null]]) };

    await expect(writeWorkbook(new PassThrough(), sheet, controller.signal)).rejects.toThrow();
  });
});
