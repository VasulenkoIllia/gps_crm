import { OBJECT_STATUS_META, type ObjectHistory } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { DataTable, DateText, EmptyValue, StatusTag, type DataTableColumn } from "../../ui";
import { fetchObjectHistory, objectHistoryKey } from "./objects.api";

interface Period {
  validFrom: string;
  validTo: string | null;
}

interface Installed extends Period {
  contractorName: string | null;
}

const FROM_COLUMN = {
  title: "З",
  key: "validFrom",
  render: (_: unknown, row: Period) => <DateText value={row.validFrom} />,
};
const TO_COLUMN = {
  title: "По",
  key: "validTo",
  render: (_: unknown, row: Period) => <DateText value={row.validTo} />,
};
const CONTRACTOR_COLUMN = {
  title: "Підрядник",
  key: "contractor",
  render: (_: unknown, row: Installed) => row.contractorName ?? <EmptyValue />,
};

const STATUS_COLUMNS: DataTableColumn<ObjectHistory["statuses"][number]>[] = [
  { title: "Статус", key: "status", render: (_, row) => <StatusTag status={OBJECT_STATUS_META[row.status]} /> },
  FROM_COLUMN,
  TO_COLUMN,
  { title: "Причина", key: "reason", render: (_, row) => row.reasonName ?? <EmptyValue /> },
  { title: "Примітка", key: "note", render: (_, row) => row.note ?? <EmptyValue /> },
];

const TERM_COLUMNS: DataTableColumn<ObjectHistory["terms"][number]>[] = [
  { title: "Платник", dataIndex: "payerName" },
  { title: "Тариф", key: "tariff", render: (_, row) => row.ownTariffName ?? "Тариф клієнта" },
  FROM_COLUMN,
  TO_COLUMN,
];

const ADDON_COLUMNS: DataTableColumn<ObjectHistory["addons"][number]>[] = [
  { title: "Послуга", dataIndex: "addonName" },
  FROM_COLUMN,
  TO_COLUMN,
];

const DEVICE_COLUMNS: DataTableColumn<ObjectHistory["devices"][number]>[] = [
  { title: "IMEI", dataIndex: "imei" },
  { title: "Модель", key: "model", render: (_, row) => row.modelName ?? <EmptyValue /> },
  FROM_COLUMN,
  TO_COLUMN,
  CONTRACTOR_COLUMN,
];

const SIM_COLUMNS: DataTableColumn<ObjectHistory["sims"][number]>[] = [
  { title: "ICCID", dataIndex: "iccid" },
  { title: "У трекері", dataIndex: "imei" },
  FROM_COLUMN,
  TO_COLUMN,
  CONTRACTOR_COLUMN,
];

const SENSOR_COLUMNS: DataTableColumn<ObjectHistory["sensors"][number]>[] = [
  { title: "Серійний номер", dataIndex: "serialNo" },
  FROM_COLUMN,
  TO_COLUMN,
  CONTRACTOR_COLUMN,
];

export function ObjectHistoryTab({ objectId }: { objectId: string }) {
  const history = useQuery({
    queryKey: objectHistoryKey(objectId),
    queryFn: ({ signal }) => fetchObjectHistory(objectId, signal),
  });
  const shared = { rowKey: "id", error: history.error, onRetry: () => void history.refetch() } as const;
  const data = history.data;
  return (
    <>
      <h3 className="form-section-title">Статуси</h3>
      <DataTable {...shared} rows={data?.statuses} columns={STATUS_COLUMNS} empty="Записів немає" />
      <h3 className="form-section-title">Умови</h3>
      <DataTable {...shared} rows={data?.terms} columns={TERM_COLUMNS} empty="Записів немає" />
      <h3 className="form-section-title">Послуги</h3>
      <DataTable {...shared} rows={data?.addons} columns={ADDON_COLUMNS} empty="Послуг не було" />
      <h3 className="form-section-title">Трекери</h3>
      <DataTable {...shared} rows={data?.devices} columns={DEVICE_COLUMNS} empty="Трекерів не було" />
      <h3 className="form-section-title">SIM-картки</h3>
      <DataTable {...shared} rows={data?.sims} columns={SIM_COLUMNS} empty="SIM-карток не було" />
      <h3 className="form-section-title">Датчики</h3>
      <DataTable {...shared} rows={data?.sensors} columns={SENSOR_COLUMNS} empty="Датчиків не було" />
    </>
  );
}
