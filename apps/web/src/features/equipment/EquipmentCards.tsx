import { DEVICE_OWNERSHIPS, DEVICE_STATUS_META, SIM_STATUS_META, type DeviceCard, type SimCard } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { DetailDrawer, EmptyValue, FactList, LoadError, Money, Phone, StatusTag, type Fact } from "../../ui";
import { deviceKey, fetchDevice, fetchSim, simKey } from "./equipment.api";
import { InstallationHistory, InstalledCell, PlaceCell } from "./EquipmentParts";

interface CardDrawerProps {
  id: string | null;
  onClose: () => void;
}

function deviceFacts(card: DeviceCard): Fact[] {
  return [
    { label: "IMEI", value: card.imei },
    { label: "Модель", value: card.modelName ?? <EmptyValue /> },
    { label: "Власність", value: card.ownership ? DEVICE_OWNERSHIPS[card.ownership] : <EmptyValue /> },
    { label: "Стан", value: <StatusTag status={DEVICE_STATUS_META[card.status]} /> },
    { label: "Де встановлено", value: <PlaceCell place={card.place} /> },
    { label: "Встановлено", value: <InstalledCell place={card.place} /> },
    { label: "Примітка", value: card.note ?? <EmptyValue /> },
  ];
}

function simFacts(card: SimCard): Fact[] {
  return [
    { label: "ICCID", value: card.iccid },
    { label: "Номер", value: <Phone value={card.msisdn} /> },
    { label: "Оператор", value: card.operatorName ?? <EmptyValue /> },
    { label: "Тариф оператора", value: card.planName ?? <EmptyValue /> },
    ...(card.planCostKop === null ? [] : [{ label: "Вартість", value: <Money kop={card.planCostKop} /> }]),
    { label: "Стан", value: <StatusTag status={SIM_STATUS_META[card.status]} /> },
    { label: "У трекері", value: card.deviceImei ?? <EmptyValue /> },
    { label: "Де встановлено", value: <PlaceCell place={card.place} /> },
    { label: "Встановлено", value: <InstalledCell place={card.place} /> },
    { label: "Примітка", value: card.note ?? <EmptyValue /> },
  ];
}

interface CardBodyProps<T extends { history: DeviceCard["history"] }> {
  card: T | undefined;
  error: unknown;
  onRetry: () => void;
  factsOf: (card: T) => Fact[];
}

function CardBody<T extends { history: DeviceCard["history"] }>({ card, error, onRetry, factsOf }: CardBodyProps<T>) {
  if (!card) return error ? <LoadError error={error} onRetry={onRetry} /> : <Skeleton active />;
  return (
    <>
      <FactList items={factsOf(card)} />
      <InstallationHistory rows={card.history} error={error} onRetry={onRetry} />
    </>
  );
}

export function DeviceDrawer({ id, onClose }: CardDrawerProps) {
  const card = useQuery({
    queryKey: deviceKey(id ?? ""),
    queryFn: ({ signal }) => fetchDevice(id ?? "", signal),
    enabled: id !== null,
  });
  return (
    <DetailDrawer title={card.data ? `Трекер ${card.data.imei}` : "Трекер"} open={id !== null} onClose={onClose}>
      <CardBody card={card.data} error={card.error} onRetry={() => void card.refetch()} factsOf={deviceFacts} />
    </DetailDrawer>
  );
}

export function SimDrawer({ id, onClose }: CardDrawerProps) {
  const card = useQuery({
    queryKey: simKey(id ?? ""),
    queryFn: ({ signal }) => fetchSim(id ?? "", signal),
    enabled: id !== null,
  });
  return (
    <DetailDrawer title={card.data ? `SIM ${card.data.iccid}` : "SIM-картка"} open={id !== null} onClose={onClose}>
      <CardBody card={card.data} error={card.error} onRetry={() => void card.refetch()} factsOf={simFacts} />
    </DetailDrawer>
  );
}
