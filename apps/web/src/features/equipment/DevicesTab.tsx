import { ARCHIVED_STATUS_META, DEVICE_STATUS_META, type DeviceRow } from "@gps_crm/shared";
import { Button } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useUrlFilters } from "../../lib/url-filters";
import {
  DataTable,
  EmptyValue,
  FilterBar,
  FilterSelect,
  NothingFound,
  SearchField,
  StatusTag,
  type DataTableColumn,
} from "../../ui";
import { useReferenceOptions } from "../references/references.api";
import { DEVICE_FILTER_KEYS, fetchDevices, type DeviceFilters } from "./equipment.api";
import { DeviceDrawer } from "./EquipmentCards";
import { DeviceForm } from "./EquipmentForms";
import { ARCHIVE_OPTIONS, InstalledCell, PlaceCell } from "./EquipmentParts";
import type { EquipmentTabProps } from "./equipment-tab";
import { useEquipmentRows } from "./useEquipmentRows";

const STATE_OPTIONS = Object.entries(DEVICE_STATUS_META).map(([value, { label }]) => ({ value, label }));
const nameOf = (row: DeviceRow) => row.imei;

function columnsOf(onOpen: (id: string) => void): DataTableColumn<DeviceRow>[] {
  return [
    {
      title: "IMEI",
      key: "imei",
      render: (_, row) => (
        <Button type="link" className="table-link" onClick={() => onOpen(row.id)}>
          {row.imei}
        </Button>
      ),
    },
    { title: "Модель", key: "model", render: (_, row) => row.modelName ?? <EmptyValue /> },
    {
      title: "Стан",
      key: "status",
      render: (_, row) => <StatusTag status={row.isArchived ? ARCHIVED_STATUS_META : DEVICE_STATUS_META[row.status]} />,
    },
    { title: "Де встановлено", key: "place", render: (_, row) => <PlaceCell place={row.place} /> },
    { title: "Встановлено", key: "installed", render: (_, row) => <InstalledCell place={row.place} /> },
  ];
}

interface DeviceFiltersBarProps {
  filters: DeviceFilters;
  hasFilters: boolean;
  onChange: (key: keyof DeviceFilters, value: string | undefined) => void;
  onReset: () => void;
}

function DeviceFiltersBar({ filters, hasFilters, onChange, onReset }: DeviceFiltersBarProps) {
  const models = useReferenceOptions("tracker-models", true);
  const contractors = useReferenceOptions("contractors", true);
  return (
    <FilterBar hasFilters={hasFilters} onReset={onReset}>
      <SearchField
        label="Пошук"
        placeholder="IMEI або останні цифри"
        value={filters.q}
        onChange={(value) => onChange("q", value)}
      />
      <FilterSelect
        label="Стан"
        value={filters.status}
        options={STATE_OPTIONS}
        onChange={(value) => onChange("status", value)}
      />
      <FilterSelect
        label="Модель"
        value={filters.modelId}
        options={models.options}
        isLoading={models.isLoading}
        hasError={models.hasError}
        onChange={(value) => onChange("modelId", value)}
      />
      <FilterSelect
        label="Підрядник"
        value={filters.contractorId}
        options={contractors.options}
        isLoading={contractors.isLoading}
        hasError={contractors.hasError}
        onChange={(value) => onChange("contractorId", value)}
      />
      <FilterSelect
        label="Архів"
        value={filters.archived}
        options={ARCHIVE_OPTIONS}
        onChange={(value) => onChange("archived", value)}
      />
    </FilterBar>
  );
}

export function DevicesTab({ isAdding, onAddClosed }: EquipmentTabProps) {
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(DEVICE_FILTER_KEYS);
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => fetchDevices(filters, cursor, signal),
    [filters],
  );
  const { table, actionsColumn, dialog } = useEquipmentRows({
    path: "devices",
    filters,
    fetchPage,
    nameOf,
    onEdit: setEditing,
  });
  const columns = useMemo(() => [...columnsOf(setOpenedId), actionsColumn], [actionsColumn]);

  return (
    <>
      <DeviceFiltersBar filters={filters} hasFilters={hasFilters} onChange={setFilter} onReset={resetFilters} />
      <DataTable
        {...table}
        columns={columns}
        empty={hasFilters ? <NothingFound onReset={resetFilters} /> : "Трекерів ще немає"}
        onRowClick={(row) => setOpenedId(row.id)}
      />
      <DeviceForm
        key={editing?.id ?? "new"}
        row={editing}
        open={isAdding || editing !== null}
        onClose={() => {
          setEditing(null);
          onAddClosed();
        }}
      />
      <DeviceDrawer id={openedId} onClose={() => setOpenedId(null)} />
      {dialog}
    </>
  );
}
