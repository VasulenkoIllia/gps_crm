import type { Writable } from "node:stream";
import { EXPORT_ROWS_MAX } from "@gps_crm/shared";
import ExcelJS from "exceljs";
import { safeCell, type Cell, type ColumnHead } from "./exports.columns.js";

const DATE_FORMAT = "dd.mm.yyyy";
// Excel refuses a sheet name over 31 characters
const SHEET_NAME_MAX_LENGTH = 31;

export interface Sheet {
  name: string;
  columns: ColumnHead[];
  // A page of the list at a time: the rows never sit in memory all at once
  pages: AsyncIterable<Cell[][]>;
}

// An answer to a person, not a failure of the system: the job does not retry it
export class ExportRefused extends Error {}

const TOO_MANY_ROWS = `У списку понад ${EXPORT_ROWS_MAX.toLocaleString("uk-UA")} рядків, а Excel стільки не вміщує. Звузьте фільтри.`;

function reasonOf(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("The export was stopped");
}

// The workbook ends when `out` has taken everything: a storage that failed on its side never takes it, and only the
// signal says so
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(reasonOf(signal));
    signal.addEventListener("abort", () => reject(reasonOf(signal)), { once: true });
  });
}

// Streams the sheet into `out` as it reads it, and ends `out`. Returns the number of rows.
export async function writeWorkbook(out: Writable, sheet: Sheet, signal: AbortSignal): Promise<number> {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  const worksheet = workbook.addWorksheet(sheet.name.slice(0, SHEET_NAME_MAX_LENGTH), {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  worksheet.columns = sheet.columns.map(({ header, width, isDate }, index) => ({
    header,
    key: String(index),
    width,
    ...(isDate ? { style: { numFmt: DATE_FORMAT } } : {}),
  }));
  worksheet.getRow(1).font = { bold: true };
  let rowCount = 0;
  for await (const page of sheet.pages) {
    // Between the pages: pg-boss has given up on this run (the next one starts from the beginning), or the storage failed
    signal.throwIfAborted();
    if (rowCount + page.length > EXPORT_ROWS_MAX) throw new ExportRefused(TOO_MANY_ROWS);
    for (const cells of page) worksheet.addRow(cells.map(safeCell)).commit();
    rowCount += page.length;
  }
  worksheet.commit();
  await Promise.race([workbook.commit(), whenAborted(signal)]);
  return rowCount;
}
