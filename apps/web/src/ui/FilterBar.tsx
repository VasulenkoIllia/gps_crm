import { Button } from "antd";
import { useId, useState, type ReactNode } from "react";

interface FilterBarProps {
  hasFilters: boolean;
  onReset: () => void;
  children: ReactNode;
  // Filters a person needs now and then: behind «Ще фільтри», so on a phone the list starts on the first screen
  more?: ReactNode;
  // How many of them are chosen: the button names the number, and a list opened with one of them shows them all
  moreChosen?: number;
}

export function ResetFiltersButton({ onReset }: { onReset: () => void }) {
  return (
    // The press keeps the focus in the field: leaving it can bring up a hint, the page moves, and the release misses the button
    <Button onMouseDown={(event) => event.preventDefault()} onClick={onReset}>
      Скинути фільтри
    </Button>
  );
}

function moreLabel(isOpen: boolean, chosen: number): string {
  if (isOpen) return "Менше фільтрів";
  return chosen > 0 ? `Ще фільтри (${chosen})` : "Ще фільтри";
}

export function FilterBar({ hasFilters, onReset, children, more, moreChosen = 0 }: FilterBarProps) {
  const moreId = useId();
  const [isMoreOpen, setMoreOpen] = useState(moreChosen > 0);
  const [seenChosen, setSeenChosen] = useState(moreChosen);
  // A hidden filter set from outside (Back, a link to the same list) opens them: the chosen one stays in sight
  if (moreChosen !== seenChosen) {
    setSeenChosen(moreChosen);
    if (moreChosen > seenChosen) setMoreOpen(true);
  }
  return (
    <div className="filter-bar" role="group" aria-label="Фільтри">
      {children}
      {more !== undefined && isMoreOpen && (
        <div id={moreId} className="filter-bar-more">
          {more}
        </div>
      )}
      {more !== undefined && (
        <Button aria-expanded={isMoreOpen} aria-controls={moreId} onClick={() => setMoreOpen(!isMoreOpen)}>
          {moreLabel(isMoreOpen, moreChosen)}
        </Button>
      )}
      {hasFilters && <ResetFiltersButton onReset={onReset} />}
    </div>
  );
}
