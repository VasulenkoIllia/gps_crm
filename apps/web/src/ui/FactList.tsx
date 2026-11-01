import type { ReactNode } from "react";

export interface Fact {
  label: string;
  value: ReactNode;
}

export function FactList({ items }: { items: Fact[] }) {
  return (
    <dl className="fact-list">
      {items.map((item) => (
        <div key={item.label} className="fact-row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
