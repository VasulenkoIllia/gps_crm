import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, activityEntityIdSchema } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Input } from "antd";
import { useMemo, useState } from "react";
import { DateFilter, FilterBar, FilterField, FilterSelect } from "../../ui";
import { SubscriberFilter } from "../subscribers/SubscriberFilter";
import { ACTIVITY_ACTORS_KEY, fetchActivityActors, type ActivityFilters as Filters } from "./activity.api";

const ID_LABEL = "ID запису";

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

const ACTION_OPTIONS = toOptions(ACTIVITY_ACTIONS);
const ENTITY_OPTIONS = toOptions(ACTIVITY_ENTITY_TYPES);

function EntityIdFilter({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [applied, setApplied] = useState(value);
  // Follows the address, which Back changes past this field. In render, not in an effect, so the old text never shows
  if (applied !== value) {
    setApplied(value);
    setText(value ?? "");
    setProblem(null);
  }

  function submit(next: string) {
    const id = next.trim();
    const result = activityEntityIdSchema.safeParse(id);
    if (id && !result.success) {
      setProblem(result.error.issues[0]?.message ?? null);
      return;
    }
    setProblem(null);
    onChange(id || undefined);
  }

  return (
    <FilterField label={ID_LABEL} hint={problem}>
      <Input.Search
        aria-label={ID_LABEL}
        className="filter-control"
        value={text}
        allowClear
        status={problem ? "error" : undefined}
        onChange={(event) => setText(event.target.value)}
        onSearch={submit}
        onBlur={() => submit(text)}
      />
    </FilterField>
  );
}

interface ActivityFiltersProps {
  filters: Filters;
  hasFilters: boolean;
  onChange: (key: keyof Filters, value: string | undefined) => void;
  onReset: () => void;
}

export function ActivityFilters({ filters, hasFilters, onChange, onReset }: ActivityFiltersProps) {
  const actors = useQuery({ queryKey: ACTIVITY_ACTORS_KEY, queryFn: ({ signal }) => fetchActivityActors(signal) });
  const actorOptions = useMemo(
    () => actors.data?.items.map(({ id, fullName }) => ({ value: id, label: fullName })) ?? [],
    [actors.data],
  );

  return (
    <FilterBar hasFilters={hasFilters} onReset={onReset}>
      <DateFilter label="Від" value={filters.from} max={filters.to} onChange={(value) => onChange("from", value)} />
      <DateFilter label="До" value={filters.to} min={filters.from} onChange={(value) => onChange("to", value)} />
      <FilterSelect
        label="Людина"
        value={filters.actorId}
        options={actorOptions}
        isLoading={actors.isPending}
        hasError={actors.isError}
        onChange={(value) => onChange("actorId", value)}
      />
      <SubscriberFilter value={filters.subscriberId} onChange={(value) => onChange("subscriberId", value)} />
      <FilterSelect
        label="Дія"
        value={filters.action}
        options={ACTION_OPTIONS}
        onChange={(value) => onChange("action", value)}
      />
      <FilterSelect
        label="Вид запису"
        value={filters.entityType}
        options={ENTITY_OPTIONS}
        onChange={(value) => onChange("entityType", value)}
      />
      <EntityIdFilter value={filters.entityId} onChange={(value) => onChange("entityId", value)} />
    </FilterBar>
  );
}
