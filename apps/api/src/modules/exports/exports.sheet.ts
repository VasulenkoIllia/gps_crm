import { EXPORT_ENTITIES, todayKyiv, type ExportRequest } from "@gps_crm/shared";
import type { RecordScope } from "../../core/access/access.js";
import type { DbOrTx } from "../../core/db/client.js";
import { listDevices, listSensors, listSims } from "../equipment/index.js";
import { listObjects } from "../objects/index.js";
import { listContracts, listSubscribers } from "../subscribers/index.js";
import {
  CONTRACT_COLUMNS,
  DEVICE_COLUMNS,
  OBJECT_COLUMNS,
  SENSOR_COLUMNS,
  SIM_COLUMNS,
  SUBSCRIBER_COLUMNS,
  type Cell,
  type Column,
} from "./exports.columns.js";
import type { Sheet } from "./exports.workbook.js";

// A statement of the worker profile reads this many rows: a few hundred milliseconds each at 1M
const BATCH_SIZE = 1_000;

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// The list of the screen, page after page by its own keyset: the same filters, sort and level of access, no OFFSET
async function* pagesOf<T>(read: (cursor: string | undefined) => Promise<Page<T>>, columns: Column<T>[]) {
  let cursor: string | undefined;
  do {
    const page = await read(cursor);
    yield page.items.map((row): Cell[] => columns.map((column) => column.value(row)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}

function sheetOf<T>(
  request: ExportRequest,
  columns: Column<T>[],
  read: (cursor: string | undefined) => Promise<Page<T>>,
): Sheet {
  return { name: EXPORT_ENTITIES[request.entity], columns, pages: pagesOf(read, columns) };
}

export function exportSheet(db: DbOrTx, request: ExportRequest, scope: RecordScope): Sheet {
  const limit = BATCH_SIZE;
  switch (request.entity) {
    case "subscribers": {
      const { filters, sort, order } = request;
      return sheetOf(request, SUBSCRIBER_COLUMNS, (cursor) =>
        listSubscribers(db, { ...filters, sort, order, cursor, limit }, scope),
      );
    }
    case "objects": {
      const { filters, sort, order } = request;
      return sheetOf(request, OBJECT_COLUMNS, (cursor) =>
        listObjects(db, { ...filters, sort, order, cursor, limit }, scope),
      );
    }
    // Equipment belongs to no client: its lists have the level «усі» only (D73)
    case "devices":
      return sheetOf(request, DEVICE_COLUMNS, (cursor) => listDevices(db, { ...request.filters, cursor, limit }));
    case "sims":
      return sheetOf(request, SIM_COLUMNS, (cursor) => listSims(db, { ...request.filters, cursor, limit }));
    case "sensors":
      return sheetOf(request, SENSOR_COLUMNS, (cursor) => listSensors(db, { ...request.filters, cursor, limit }));
    // One day for the whole file: «спливає» and the status of a contract are counted from it, as on the screen
    case "contracts": {
      const today = todayKyiv();
      return sheetOf(request, CONTRACT_COLUMNS, (cursor) =>
        listContracts(db, { ...request.filters, cursor, limit }, scope, today),
      );
    }
  }
}
