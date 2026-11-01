import type { ObjectCard } from "@gps_crm/shared";
import { Button, Empty } from "antd";
import { useMemo } from "react";
import {
  DataTable,
  DateText,
  EmptyValue,
  FactList,
  Phone,
  RowActions,
  type DataTableColumn,
  type Fact,
} from "../../ui";

type Sensor = ObjectCard["sensors"][number];

export type EquipmentAction = "device" | "sim" | "addSensor";

interface ObjectEquipmentTabProps {
  card: ObjectCard;
  canReplaceDevice: boolean;
  canReplaceSim: boolean;
  canChangeSensors: boolean;
  onAction: (action: EquipmentAction) => void;
  onRemoveSensor: (sensor: Sensor) => void;
}

function installed({ installedOn, contractorName }: { installedOn: string; contractorName: string | null }): Fact[] {
  return [
    { label: "Встановлено", value: <DateText value={installedOn} /> },
    { label: "Підрядник", value: contractorName ?? <EmptyValue /> },
  ];
}

function deviceFacts(device: NonNullable<ObjectCard["device"]>): Fact[] {
  return [
    { label: "IMEI", value: device.imei },
    { label: "Модель", value: device.modelName ?? <EmptyValue /> },
    ...installed(device),
  ];
}

function simFacts(sim: NonNullable<ObjectCard["sim"]>): Fact[] {
  return [
    { label: "ICCID", value: sim.iccid },
    { label: "Номер", value: <Phone value={sim.msisdn} /> },
    { label: "Оператор", value: sim.operatorName ?? <EmptyValue /> },
    { label: "Тариф оператора", value: sim.planName ?? <EmptyValue /> },
    ...installed(sim),
  ];
}

function sensorColumns(canChange: boolean, onRemove: (sensor: Sensor) => void): DataTableColumn<Sensor>[] {
  return [
    { title: "Серійний номер", dataIndex: "serialNo" },
    { title: "Встановлено", key: "installedOn", render: (_, row) => <DateText value={row.installedOn} /> },
    { title: "Підрядник", key: "contractor", render: (_, row) => row.contractorName ?? <EmptyValue /> },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, row) => (
        <RowActions
          rowName={`Датчик ${row.serialNo}`}
          actions={canChange ? [{ key: "remove", label: "Зняти" }] : []}
          onAction={() => onRemove(row)}
        />
      ),
    },
  ];
}

export function ObjectEquipmentTab(props: ObjectEquipmentTabProps) {
  const { card, canReplaceDevice, canReplaceSim, canChangeSensors, onAction, onRemoveSensor } = props;
  const columns = useMemo(() => sensorColumns(canChangeSensors, onRemoveSensor), [canChangeSensors, onRemoveSensor]);
  return (
    <>
      <h3 className="form-section-title">Трекер</h3>
      {card.device ? <FactList items={deviceFacts(card.device)} /> : <Empty description="Трекера немає" />}
      <h3 className="form-section-title">SIM-картка</h3>
      {card.sim ? <FactList items={simFacts(card.sim)} /> : <Empty description="SIM немає" />}
      {canReplaceSim && (
        <div className="tab-actions">
          <Button onClick={() => onAction("sim")}>Замінити SIM</Button>
        </div>
      )}
      <h3 className="form-section-title">Датчики</h3>
      {canChangeSensors && (
        <div className="tab-actions">
          <Button onClick={() => onAction("addSensor")}>Додати датчик</Button>
        </div>
      )}
      <DataTable
        rows={card.sensors}
        columns={columns}
        rowKey="id"
        error={null}
        empty="Датчиків немає"
        onRetry={() => undefined}
      />
      {!card.device && canReplaceDevice && (
        <div className="tab-actions">
          <Button onClick={() => onAction("device")}>Встановити трекер</Button>
        </div>
      )}
    </>
  );
}
