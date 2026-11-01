import { ARCHIVED_STATUS_META, SIM_STATUS_META, type SimRow } from "@gps_crm/shared";
import { Button } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useUrlFilters } from "../../lib/url-filters";
import {
  DataTable,
  EmptyValue,
  FilterBar,
  FilterSelect,
  NothingFound,
  Phone,
  SearchField,
  StatusTag,
  type DataTableColumn,
} from "../../ui";
import { useReferenceOptions } from "../references/references.api";
import { fetchSims, SIM_FILTER_KEYS, type SimFilters } from "./equipment.api";
import type { EquipmentTabProps } from "./equipment-tab";
import { SimDrawer } from "./EquipmentCards";
import { SimForm } from "./EquipmentForms";
import { ARCHIVE_OPTIONS, InstalledCell, PlaceCell } from "./EquipmentParts";
import { useEquipmentRows } from "./useEquipmentRows";

const STATE_OPTIONS = Object.entries(SIM_STATUS_META).map(([value, { label }]) => ({ value, label }));
const nameOf = (row: SimRow) => row.iccid;

function columnsOf(onOpen: (id: string) => void): DataTableColumn<SimRow>[] {
  return [
    {
      title: "ICCID",
      key: "iccid",
      render: (_, row) => (
        <Button type="link" className="table-link" onClick={() => onOpen(row.id)}>
          {row.iccid}
        </Button>
      ),
    },
    { title: "Номер", key: "msisdn", render: (_, row) => <Phone value={row.msisdn} /> },
    {
      title: "Оператор і тариф",
      key: "operator",
      render: (_, row) => (
        <>
          {row.operatorName ?? <EmptyValue />}
          {row.planName && <div className="table-note">{row.planName}</div>}
        </>
      ),
    },
    {
      title: "Стан",
      key: "status",
      render: (_, row) => <StatusTag status={row.isArchived ? ARCHIVED_STATUS_META : SIM_STATUS_META[row.status]} />,
    },
    { title: "Де встановлено", key: "place", render: (_, row) => <PlaceCell place={row.place} /> },
    { title: "Встановлено", key: "installed", render: (_, row) => <InstalledCell place={row.place} /> },
  ];
}

interface SimFiltersBarProps {
  filters: SimFilters;
  hasFilters: boolean;
  onChange: (key: keyof SimFilters, value: string | undefined) => void;
  onReset: () => void;
}

function SimFiltersBar({ filters, hasFilters, onChange, onReset }: SimFiltersBarProps) {
  const operators = useReferenceOptions("sim-operators", true);
  const contractors = useReferenceOptions("contractors", true);
  return (
    <FilterBar hasFilters={hasFilters} onReset={onReset}>
      <SearchField
        label="Пошук"
        placeholder="ICCID, номер або останні цифри"
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
        label="Оператор"
        value={filters.operatorId}
        options={operators.options}
        isLoading={operators.isLoading}
        hasError={operators.hasError}
        onChange={(value) => onChange("operatorId", value)}
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

export function SimsTab({ isAdding, onAddClosed }: EquipmentTabProps) {
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(SIM_FILTER_KEYS);
  const [editing, setEditing] = useState<SimRow | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => fetchSims(filters, cursor, signal),
    [filters],
  );
  const { table, actionsColumn, dialog } = useEquipmentRows({
    path: "sims",
    filters,
    fetchPage,
    nameOf,
    onEdit: setEditing,
  });
  const columns = useMemo(() => [...columnsOf(setOpenedId), actionsColumn], [actionsColumn]);

  return (
    <>
      <SimFiltersBar filters={filters} hasFilters={hasFilters} onChange={setFilter} onReset={resetFilters} />
      <DataTable
        {...table}
        columns={columns}
        empty={hasFilters ? <NothingFound onReset={resetFilters} /> : "SIM-карток ще немає"}
        onRowClick={(row) => setOpenedId(row.id)}
      />
      <SimForm
        key={editing?.id ?? "new"}
        row={editing}
        open={isAdding || editing !== null}
        onClose={() => {
          setEditing(null);
          onAddClosed();
        }}
      />
      <SimDrawer id={openedId} onClose={() => setOpenedId(null)} />
      {dialog}
    </>
  );
}
