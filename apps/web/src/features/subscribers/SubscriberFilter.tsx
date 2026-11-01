import { useQuery } from "@tanstack/react-query";
import { useCan } from "../../lib/session";
import { FilterField, RemoteSelect } from "../../ui";
import { fetchSubscriber, searchSubscribers, subscriberKey } from "./subscribers.api";

const LABEL = "Клієнт";
const LOADING_LABEL = "Завантаження";
const UNKNOWN_LABEL = "Невідомий клієнт";

interface SubscriberFilterProps {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}

// The address holds an id, and after a reload the name has to come from somewhere
export function SubscriberFilter({ value, onChange }: SubscriberFilterProps) {
  const canRead = useCan("subscribers.read");
  const chosen = useQuery({
    queryKey: subscriberKey(value ?? ""),
    queryFn: ({ signal }) => fetchSubscriber(value ?? "", signal),
    enabled: canRead && value !== undefined,
  });
  if (!canRead) return null;
  const notFound = chosen.isError ? UNKNOWN_LABEL : LOADING_LABEL;
  return (
    <FilterField label={LABEL}>
      <RemoteSelect
        aria-label={LABEL}
        className="filter-control"
        name="subscribers"
        allowClear
        value={value}
        chosenLabel={chosen.data ? `${chosen.data.code} ${chosen.data.name}` : notFound}
        search={searchSubscribers}
        onChange={onChange}
      />
    </FilterField>
  );
}
