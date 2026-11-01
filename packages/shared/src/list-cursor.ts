import { z } from "zod";

const ID_LENGTH = 36;
// A value of the sort column and the id: as long as a name may get, and no longer
const CURSOR_MAX_LENGTH = 700;
const LIST_CURSOR = /_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export interface ListCursor {
  value: string;
  id: string;
}

// Keyset (06-quality.md §6.1): the value of the sort column and the id. The id has a fixed length, so a name holding the
// separator does not matter.
export function encodeListCursor({ value, id }: ListCursor): string {
  return `${value}_${id}`;
}

export function decodeListCursor(cursor: string): ListCursor {
  const separator = cursor.length - ID_LENGTH - 1;
  return { value: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
}

export const listCursorSchema = z.string().max(CURSOR_MAX_LENGTH).regex(LIST_CURSOR, "Некоректний курсор");
