import type { ReactNode } from "react";
import { digitGroups } from "../lib/format";

export function Code({ children }: { children: ReactNode }) {
  return <code className="code-text">{children}</code>;
}

// IMEI, ICCID: monospace, in groups, on one line. The gaps are margins, not spaces: a copy gives the bare number.
export function DigitsText({ value }: { value: string }) {
  return (
    <span className="digits-text">
      {digitGroups(value).map((group, index) => (
        <span key={index}>{group}</span>
      ))}
    </span>
  );
}
