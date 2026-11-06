import { searchTooShortText } from "@gps_crm/shared";
import { ResetFiltersButton } from "./FilterBar";

// `q`: the search of the list, which may be too short to find anything at all
export function NothingFound({ onReset, q }: { onReset: () => void; q?: string }) {
  return (
    <>
      <p className="nothing-found">{searchTooShortText(q) ?? "За цими фільтрами нічого немає"}</p>
      <ResetFiltersButton onReset={onReset} />
    </>
  );
}
