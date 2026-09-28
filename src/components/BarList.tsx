import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { fmtNum } from "./format";

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  color?: string;
  /** Tooltip text shown on hover. */
  hint?: ReactNode;
}

/** Horizontal single-measure bars with the value at the bar tip (thin marks, rounded data end). */
export function BarList({ rows, color = "#2a78d6", format = (n: number) => fmtNum(n) }: {
  rows: BarRow[];
  color?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="muted">Немає даних</div>;
  return (
    <div className="barlist" role="list">
      {rows.map((r) => (
        <Tooltip key={r.key} title={r.hint} placement="topLeft">
          <div className="barlist-row" role="listitem">
            <span className="barlist-label">{r.label}</span>
            <span className="barlist-track">
              <span
                className="barlist-bar"
                style={{ display: "block", width: `${(r.value / max) * 100}%`, background: r.color ?? color }}
              />
            </span>
            <span className="barlist-value">{format(r.value)}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
