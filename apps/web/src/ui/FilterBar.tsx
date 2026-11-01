import { Button } from "antd";
import type { ReactNode } from "react";

interface FilterBarProps {
  hasFilters: boolean;
  onReset: () => void;
  children: ReactNode;
}

export function ResetFiltersButton({ onReset }: { onReset: () => void }) {
  return (
    // The press keeps the focus in the field: leaving it can bring up a hint, the page moves, and the release misses the button
    <Button onMouseDown={(event) => event.preventDefault()} onClick={onReset}>
      Скинути фільтри
    </Button>
  );
}

export function FilterBar({ hasFilters, onReset, children }: FilterBarProps) {
  return (
    <div className="filter-bar" role="group" aria-label="Фільтри">
      {children}
      {hasFilters && <ResetFiltersButton onReset={onReset} />}
    </div>
  );
}
