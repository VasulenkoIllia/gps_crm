import type { ReactNode } from "react";
import { EMPTY_VALUE } from "../lib/format";

// A new tab, and without the opener: the page on the other side is not ours
export function ExternalLink({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  if (!href) return <>{EMPTY_VALUE}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
