import { useId, type ReactNode } from "react";

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className="panel" aria-labelledby={title ? titleId : undefined}>
      {title && (
        <h2 id={titleId} className="panel-title">
          {title}
        </h2>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
