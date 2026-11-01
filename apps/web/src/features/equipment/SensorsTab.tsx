import type { SensorRow } from "@gps_crm/shared";
import { useCallback, useMemo, useState } from "react";
import { useUrlFilters } from "../../lib/url-filters";
import {
  DataTable,
  EmptyValue,
  FilterBar,
  FilterSelect,
  NothingFound,
  SearchField,
  type DataTableColumn,
} from "../../ui";
import { useReferenceOptions } from "../references/references.api";
import { fetchSensors, SENSOR_FILTER_KEYS } from "./equipment.api";
import type { EquipmentTabProps } from "./equipment-tab";
import { SensorForm } from "./EquipmentForms";
import { ARCHIVE_OPTIONS, InstalledCell, PlaceCell } from "./EquipmentParts";
import { useEquipmentRows } from "./useEquipmentRows";

const nameOf = (row: SensorRow) => row.serialNo;

const COLUMNS: DataTableColumn<SensorRow>[] = [
  { title: "Серійний номер", key: "serialNo", render: (_, row) => row.serialNo },
  { title: "Де встановлено", key: "place", render: (_, row) => <PlaceCell place={row.place} /> },
  { title: "Встановлено", key: "installed", render: (_, row) => <InstalledCell place={row.place} /> },
  { title: "Примітка", key: "note", render: (_, row) => row.note ?? <EmptyValue /> },
];

export function SensorsTab({ isAdding, onAddClosed }: EquipmentTabProps) {
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(SENSOR_FILTER_KEYS);
  const contractors = useReferenceOptions("contractors", true);
  const [editing, setEditing] = useState<SensorRow | null>(null);
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => fetchSensors(filters, cursor, signal),
    [filters],
  );
  const { table, actionsColumn, dialog } = useEquipmentRows({
    path: "sensors",
    filters,
    fetchPage,
    nameOf,
    onEdit: setEditing,
  });
  const columns = useMemo(() => [...COLUMNS, actionsColumn], [actionsColumn]);

  return (
    <>
      <FilterBar hasFilters={hasFilters} onReset={resetFilters}>
        <SearchField
          label="Пошук"
          placeholder="Серійний номер"
          value={filters.q}
          onChange={(value) => setFilter("q", value)}
        />
        <FilterSelect
          label="Підрядник"
          value={filters.contractorId}
          options={contractors.options}
          isLoading={contractors.isLoading}
          hasError={contractors.hasError}
          onChange={(value) => setFilter("contractorId", value)}
        />
        <FilterSelect
          label="Архів"
          value={filters.archived}
          options={ARCHIVE_OPTIONS}
          onChange={(value) => setFilter("archived", value)}
        />
      </FilterBar>
      <DataTable
        {...table}
        columns={columns}
        empty={hasFilters ? <NothingFound onReset={resetFilters} /> : "Датчиків ще немає"}
      />
      <SensorForm
        key={editing?.id ?? "new"}
        row={editing}
        open={isAdding || editing !== null}
        onClose={() => {
          setEditing(null);
          onAddClosed();
        }}
      />
      {dialog}
    </>
  );
}
