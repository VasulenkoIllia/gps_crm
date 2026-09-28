import dayjs from "dayjs";

export const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("uk-UA")} грн`;
export const fmtNum = (n: number, digits = 0) =>
  n.toLocaleString("uk-UA", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtDate = (d?: string) => (d ? dayjs(d).format("DD.MM.YYYY") : "—");
export const fmtDateTime = (d?: string) => (d ? dayjs(d).format("DD.MM.YYYY HH:mm") : "—");
export const pct = (part: number, total: number) => (total ? Math.round((part / total) * 100) : 0);

/** Case-insensitive "contains" for search fields; ignores spaces so IMEI / phone search works. */
export const matches = (query: string, ...fields: (string | undefined)[]) => {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().replace(/\s+/g, "").includes(q));
};
