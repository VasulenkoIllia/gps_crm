import type { EquipmentPlace, Installation } from "@gps_crm/shared";
import { DataTable, DateText, EmptyValue, EntityLink, type DataTableColumn } from "../../ui";

export const ARCHIVE_OPTIONS = [{ value: "true", label: "В архіві" }];

export function PlaceCell({ place }: { place: EquipmentPlace | null }) {
  if (!place) return <EmptyValue />;
  return (
    <>
      <EntityLink to={`/objects/${place.objectId}`}>{place.objectName}</EntityLink>
      <div className="table-note">
        <EntityLink to={`/subscribers/${place.subscriberId}`}>
          {place.subscriberCode} {place.subscriberName}
        </EntityLink>
      </div>
    </>
  );
}

export function InstalledCell({ place }: { place: EquipmentPlace | null }) {
  if (!place) return <EmptyValue />;
  return (
    <>
      <DateText value={place.installedOn} />
      {place.contractorName && <div className="table-note">{place.contractorName}</div>}
    </>
  );
}

const HISTORY_COLUMNS: DataTableColumn<Installation>[] = [
  {
    title: "Де стояло",
    key: "label",
    render: (_, row) =>
      row.objectId ? <EntityLink to={`/objects/${row.objectId}`}>{row.label}</EntityLink> : row.label,
  },
  { title: "З", key: "validFrom", render: (_, row) => <DateText value={row.validFrom} /> },
  { title: "По", key: "validTo", render: (_, row) => <DateText value={row.validTo} /> },
  { title: "Підрядник", key: "contractorName", render: (_, row) => row.contractorName ?? <EmptyValue /> },
];

interface InstallationHistoryProps {
  rows: Installation[];
  error: unknown;
  onRetry: () => void;
}

export function InstallationHistory({ rows, error, onRetry }: InstallationHistoryProps) {
  return (
    <>
      <h3 className="form-section-title">Історія встановлень</h3>
      <DataTable
        rows={rows}
        columns={HISTORY_COLUMNS}
        rowKey="id"
        error={error}
        empty="Ще ніде не стояло"
        onRetry={onRetry}
      />
    </>
  );
}
