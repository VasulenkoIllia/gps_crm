import type { ReactNode } from "react";

interface FilterFieldProps {
  label: string;
  hint?: string | null;
  children: ReactNode;
}

// The word stays on screen once a value is chosen, which a placeholder does not. The control keeps its own aria-label:
// a filter is a Select, a date or a search field, and not all of them take a <label>.
export function FilterField({ label, hint, children }: FilterFieldProps) {
  return (
    <div className="filter-field">
      <div className="filter-label" aria-hidden="true">
        {label}
      </div>
      {children}
      {hint && (
        <div className="field-hint" role="alert">
          {hint}
        </div>
      )}
    </div>
  );
}
