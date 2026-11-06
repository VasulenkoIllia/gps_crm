import { randomBytes } from "node:crypto";
import { isImeiChecksumValid, isValidEdrpou, isValidIpn, todayKyiv, type ActivityAction } from "@gps_crm/shared";

// The rows of the demo seed (seed-demo.ts) and what builds them. Plain TypeScript the image's Node runs as it is: the
// staging run mounts these files into a container of the app image, which has no tsx.

// A moment of the demo's story. The journal gets its times only once the whole story is built: the seed spreads the
// moments, in order, over the days the journal has partitions for.
export class Moment {
  readonly index: number;

  constructor(index: number) {
    this.index = index;
  }
}

export class Timeline {
  private count = 0;
  private startMs = 0;
  private stepMs = 0;

  next(): Moment {
    return new Moment(this.count++);
  }

  spread(startMs: number, endMs: number): void {
    this.startMs = startMs;
    this.stepMs = (endMs - startMs) / Math.max(this.count, 1);
  }

  dateOf(moment: Moment): Date {
    return new Date(Math.round(this.startMs + (moment.index + 0.5) * this.stepMs));
  }

  // The business date of a moment, as the app counts it: an archive closes the equipment on the day of Kyiv (D71)
  dayOf(moment: Moment): () => string {
    return () => todayKyiv(this.dateOf(moment));
  }
}

// A value of a row: a business date is text, a moment becomes a time when the timeline is spread, a function is read then
export type Cell = string | number | boolean | null | Moment | (() => string);
// A value read off a row may be missing as far as the types know: the insert refuses a row whose columns differ
export type Row = Record<string, Cell | undefined>;

export class Rows {
  readonly tables = new Map<string, Row[]>();

  add(table: string, row: Row): Row {
    const list = this.tables.get(table) ?? [];
    list.push(row);
    this.tables.set(table, list);
    return row;
  }

  of(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }
}

export interface DemoEvent {
  action: ActivityAction;
  entityType: string;
  entityId: string;
  subscriberId?: string | null;
  details?: Record<string, string | number | null>;
  changes?: Record<string, [string | null, string | null]>;
}

// The journal as the services write it (core/activity): details and changes in one column, the lines of one action
// with one moment and one request id, which is how a package of the archive finds its records (D92)
export class Journal {
  private readonly rows: Rows;
  private readonly timeline: Timeline;
  private readonly ids: () => string;
  private requests = 0;

  constructor(rows: Rows, timeline: Timeline, ids: () => string) {
    this.rows = rows;
    this.timeline = timeline;
    this.ids = ids;
  }

  record(actorId: string, events: DemoEvent[], moment: Moment = this.timeline.next()): Moment {
    this.requests += 1;
    const requestId = `demo-seed-${String(this.requests).padStart(4, "0")}`;
    for (const event of events) {
      const changes = { ...event.details, ...event.changes };
      this.rows.add("activity_events", {
        occurred_at: moment,
        id: this.ids(),
        actor_kind: "user",
        actor_id: actorId,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId,
        subscriber_id: event.subscriberId ?? null,
        changes: Object.keys(changes).length > 0 ? JSON.stringify(changes) : null,
        request_id: requestId,
      });
    }
    return moment;
  }
}

export interface DemoUser {
  id: string;
  fullName: string;
}

// What every builder writes into: the rows, the journal, and the actions recorded after everything was entered
export interface Demo {
  today: string;
  ids: () => string;
  rows: Rows;
  timeline: Timeline;
  journal: Journal;
  admin: DemoUser;
  managers: DemoUser[];
  // The content of every file the rows name, written to the storage before the rows are committed
  files: { key: string; content: Buffer }[];
  later: (action: () => void) => void;
}

// created_* and updated_* of a record made at this moment by this person
export function stamps(moment: Moment, actorId: string): Row {
  return { created_at: moment, created_by: actorId, updated_at: moment, updated_by: actorId };
}

export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the demo names ${what}, which it does not define`);
  return value;
}

// A value of a row the demo set itself as text or a number: a moment or a lazy day has no text yet
export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value === "string" || typeof value === "number") return String(value);
  throw new Error(`${column} of a row of the demo is not text`);
}

export const ARCHIVE_COLUMNS = { archived_at: null, archived_by: null, archive_batch_id: null };

interface BatchFields {
  kind: string;
  label: string;
  count: number;
  subscriberId: string | null;
  actorId: string;
}

// A package of the archive and its line (activity.service.ts openArchiveBatch). Its moment is the moment of the lines of
// its records: the journal finds them within minutes of the package (D92).
export function archiveBatch(demo: Demo, moment: Moment, fields: BatchFields): { id: string; event: DemoEvent } {
  const id = demo.ids();
  demo.rows.add("archive_batches", {
    id,
    entity_type: fields.kind,
    label: fields.label,
    item_count: fields.count,
    subscriber_id: fields.subscriberId,
    archived_at: moment,
    archived_by: fields.actorId,
  });
  const event: DemoEvent = {
    action: "record.archived",
    entityType: "archive_batch",
    entityId: id,
    subscriberId: fields.subscriberId,
    details: { label: fields.label, kind: fields.kind, itemCount: fields.count },
  };
  return { id, event };
}

const UUID_VERSION_7 = 0x70;
const UUID_VARIANT = 0x80;

// uuidv7 as the database makes it, from a clock of our own: one millisecond per record keeps the order of creation, so
// a list «newest first» reads the demo as it was entered, and records made later in the app come after all of them
export function idClock(startMs: number): () => string {
  let ms = startMs;
  return () => {
    const bytes = randomBytes(16);
    bytes.writeUIntBE(ms++, 0, 6);
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | UUID_VERSION_7;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | UUID_VARIANT;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

function withCheckDigit(head: string, isValid: (code: string) => boolean): string {
  for (let digit = 0; digit <= 9; digit++) {
    if (isValid(`${head}${digit}`)) return `${head}${digit}`;
  }
  throw new Error(`no check digit makes ${head} valid`);
}

// Codes the forms take on the next change of the record: the check digit is the one packages/shared checks
export const edrpouOf = (n: number) => withCheckDigit(String(3_140_000 + n * 7_919), isValidEdrpou);
export const ipnOf = (n: number) => withCheckDigit(String(312_000_000 + n * 104_729).padStart(9, "0"), isValidIpn);
export const imeiOf = (n: number) =>
  withCheckDigit(`35693803${String(100_000 + n * 37).padStart(6, "0")}`, isImeiChecksumValid);
export const iccidOf = (n: number) => `8938003${String(9_900_000_000 + n * 13).padStart(12, "0")}`;
export const mobileOf = (code: string, n: number) => `+380${code}${String(1_000_100 + n * 7_331).padStart(7, "0")}`;

function pdfText(line: string): string {
  return line.replace(/[\\()]/g, (char) => `\\${char}`);
}

// A one-page PDF in Latin letters: the standard font of a PDF has no Cyrillic, and a demo file needs no font of its own
export function contractPdf(lines: string[]): Buffer {
  const text = lines.map((line, i) => `BT /F1 14 Tf 72 ${760 - i * 24} Td (${pdfText(line)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
