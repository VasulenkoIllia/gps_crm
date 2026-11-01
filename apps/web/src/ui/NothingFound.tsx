import { ResetFiltersButton } from "./FilterBar";

export function NothingFound({ onReset }: { onReset: () => void }) {
  return (
    <>
      <p className="nothing-found">За цими фільтрами нічого немає</p>
      <ResetFiltersButton onReset={onReset} />
    </>
  );
}
