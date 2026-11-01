const APOSTROPHES = /[’ʼ‘`´]/g;

// `*_norm` columns (03-data-model.md §3.1): what makes «Об’єкт  1» and «об'єкт 1» one name.
// NFC, because a text pasted from a Mac may spell «й» as «и» and a combining mark.
export function normalizeName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").replace(APOSTROPHES, "'").toLowerCase();
}
