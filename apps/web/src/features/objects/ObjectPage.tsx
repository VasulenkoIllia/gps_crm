import { type ObjectCard } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useCan } from "../../lib/session";
import {
  DateText,
  DateTimeText,
  DetailPage,
  EmptyValue,
  EntityLink,
  FactList,
  LoadError,
  NoAccess,
  RowActions,
  type DetailTab,
  type Fact,
} from "../../ui";
import { ACTIVITY_KEY } from "../activity/activity.api";
import { RecordActivityTab } from "../activity/RecordActivityTab";
import { useConfirmedAction, type PlannedAction } from "../subscribers/useConfirmedAction";
import { ObjectStatusTag, tariffText } from "./object-columns";
import { ObjectAddonsTab } from "./ObjectAddonsTab";
import { AddSensorModal, RemoveSensorModal, ReplaceDeviceModal, ReplaceSimModal } from "./ObjectEquipmentForms";
import { ObjectEquipmentTab, type EquipmentAction } from "./ObjectEquipmentTab";
import {
  ObjectAddonModal,
  ObjectEditModal,
  ObjectPayerModal,
  ObjectStatusModal,
  ObjectTariffModal,
} from "./ObjectForms";
import { ObjectHistoryTab } from "./ObjectHistoryTab";
import { deleteObject, fetchObject, fetchObjectActivity, objectAction, objectKey } from "./objects.api";

type RecordAction = "edit" | "archive" | "restore" | "delete";
type HeaderForm = "status" | "tariff" | "payer";
type AddonForm = "connectAddon" | "disconnectAddon";
type CardForm = HeaderForm | AddonForm | EquipmentAction | "edit" | "removeSensor";

interface OpenedForm {
  form: CardForm;
  card: ObjectCard;
  addonId?: string;
  sensor?: ObjectCard["sensors"][number];
}

function factsOf(card: ObjectCard): Fact[] {
  const { tariff, nextTariff } = card;
  return [
    {
      label: "Клієнт",
      value: (
        <EntityLink to={`/subscribers/${card.subscriberId}`}>
          {card.subscriberCode} {card.subscriberName}
        </EntityLink>
      ),
    },
    { label: "Програма", value: tariff.programName },
    { label: "Сервер", value: tariff.serverName },
    { label: "Тариф", value: tariff.isOwn ? tariffText(tariff) : `${tariff.tariffName} (тариф клієнта)` },
    ...(nextTariff
      ? [
          {
            label: "Наступний тариф",
            value: (
              <>
                {tariffText(nextTariff)} з <DateText value={nextTariff.validFrom} />
              </>
            ),
          },
        ]
      : []),
    {
      label: "Платник",
      value: (
        <>
          {card.payerName} з <DateText value={card.payerFrom} />
        </>
      ),
    },
    { label: "Дата підключення", value: <DateText value={card.connectedOn} /> },
    ...(card.disconnectReasonName ? [{ label: "Причина відключення", value: card.disconnectReasonName }] : []),
    { label: "Створено", value: <DateTimeText value={card.createdAt} /> },
    { label: "Примітка", value: card.note ?? <EmptyValue /> },
  ];
}

function planFor({ id, name }: ObjectCard, key: Exclude<RecordAction, "edit">, onDeleted: () => void): PlannedAction {
  const plans: Record<Exclude<RecordAction, "edit">, PlannedAction> = {
    archive: {
      title: `Архівувати: ${name}?`,
      consequence:
        "Об'єкт зникне зі списків, а трекер, SIM і датчики звільняться сьогоднішнім днем. З архіву об'єкт повернеться відключеним і без обладнання.",
      actionLabel: "Архівувати",
      doneText: "Об'єкт в архіві",
      run: () => objectAction(id, "archive"),
    },
    restore: {
      title: `Відновити: ${name}?`,
      consequence: "Об'єкт повернеться відключеним і без обладнання.",
      actionLabel: "Відновити",
      doneText: "Об'єкт відновлено",
      run: () => objectAction(id, "restore"),
    },
    delete: {
      title: `Видалити: ${name}?`,
      consequence:
        "Лише для запису, створеного помилково: обладнання стане вільним. Об'єкт з історією можна тільки архівувати.",
      actionLabel: "Видалити",
      doneText: "Об'єкт видалено",
      isDanger: true,
      run: () => deleteObject(id),
      onDone: onDeleted,
    },
  };
  return plans[key];
}

function useRights(card: ObjectCard) {
  const canWrite = useCan("objects.write");
  const canChangeStatus = useCan("objects.status.change");
  const canChangeEquipment = useCan("equipment.write");
  const canArchive = useCan("records.archive");
  const canDelete = useCan("records.delete");
  const isLive = !card.isArchived;
  const isWorking = isLive && card.status !== "disconnected";
  return {
    // D71: back from the archive there is no tracker, and without one the only way on is refused
    canChangeStatus: canChangeStatus && isLive && (isWorking || card.device !== null),
    canChangeTerms: canWrite && isWorking,
    // D71: an object back from the archive gets a tracker before it can reconnect
    canReplaceDevice: canChangeEquipment && isLive && (isWorking || !card.device),
    canReplaceSim: canChangeEquipment && isWorking && card.device !== null,
    canChangeSensors: canChangeEquipment && isWorking,
    records: [
      { key: "edit", label: "Змінити", isOn: canWrite && isWorking },
      { key: "archive", label: "Архівувати", isOn: canArchive && isLive && card.status === "disconnected" },
      { key: "restore", label: "Відновити", isOn: canArchive && !isLive },
      { key: "delete", label: "Видалити", isOn: canDelete && isLive },
    ].filter(({ isOn }) => isOn) as { key: RecordAction; label: string }[],
  };
}

function ObjectView({ card }: { card: ObjectCard }) {
  const navigate = useNavigate();
  const canReadActivity = useCan("activity.read");
  const rights = useRights(card);
  const confirm = useConfirmedAction();
  // The card as the form was opened on it: a refetch must not move the version under what the person is reading
  const [opened, setOpened] = useState<OpenedForm | null>(null);
  const openForm = useCallback((form: CardForm) => setOpened({ form, card }), [card]);
  const removeSensor = useCallback(
    (sensor: OpenedForm["sensor"]) => setOpened({ form: "removeSensor", card, sensor }),
    [card],
  );
  const disconnectAddon = useCallback(
    ({ addonId }: { addonId: string }) => setOpened({ form: "disconnectAddon", card, addonId }),
    [card],
  );
  const closeForm = () => setOpened(null);
  const formCard = opened?.card ?? card;
  const isOpen = (form: CardForm) => opened?.form === form;
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => fetchObjectActivity(card.id, cursor, signal),
    [card.id],
  );

  const tabs: DetailTab[] = [
    {
      key: "equipment",
      label: "Обладнання",
      render: () => (
        <ObjectEquipmentTab
          card={card}
          canReplaceDevice={rights.canReplaceDevice}
          canReplaceSim={rights.canReplaceSim}
          canChangeSensors={rights.canChangeSensors}
          onAction={openForm}
          onRemoveSensor={removeSensor}
        />
      ),
    },
    {
      key: "addons",
      label: "Послуги",
      render: () => (
        <ObjectAddonsTab
          card={card}
          canChange={rights.canChangeTerms}
          onConnect={() => openForm("connectAddon")}
          onDisconnect={disconnectAddon}
        />
      ),
    },
    { key: "history", label: "Історія", render: () => <ObjectHistoryTab objectId={card.id} /> },
    ...(canReadActivity
      ? [
          {
            key: "activity",
            label: "Журнал змін",
            render: () => <RecordActivityTab queryKey={[...ACTIVITY_KEY, "object", card.id]} fetchPage={fetchPage} />,
          },
        ]
      : []),
  ];

  function chooseRecordAction(key: RecordAction) {
    if (key === "edit") openForm("edit");
    else confirm.ask(planFor(card, key, () => void navigate("/objects")));
  }

  return (
    <>
      <DetailPage
        title={card.name}
        subtitle={
          <div className="detail-subtitle">
            <ObjectStatusTag status={card.status} statusFrom={card.statusFrom} isArchived={card.isArchived} />
          </div>
        }
        actions={
          <div className="detail-actions">
            {rights.canChangeStatus && <Button onClick={() => openForm("status")}>Змінити статус</Button>}
            {rights.canChangeTerms && <Button onClick={() => openForm("tariff")}>Тариф об'єкта</Button>}
            {rights.canChangeTerms && <Button onClick={() => openForm("payer")}>Змінити платника</Button>}
            {rights.canReplaceDevice && card.device && (
              <Button onClick={() => openForm("device")}>Замінити трекер</Button>
            )}
            <RowActions rowName={card.name} actions={rights.records} onAction={chooseRecordAction} />
          </div>
        }
        facts={<FactList items={factsOf(card)} />}
        tabs={tabs}
      />
      <ObjectEditModal card={formCard} open={isOpen("edit")} onClose={closeForm} />
      <ObjectStatusModal card={formCard} open={isOpen("status")} onClose={closeForm} />
      <ObjectTariffModal card={formCard} open={isOpen("tariff")} onClose={closeForm} />
      <ObjectPayerModal card={formCard} open={isOpen("payer")} onClose={closeForm} />
      <ObjectAddonModal card={formCard} action="connect" open={isOpen("connectAddon")} onClose={closeForm} />
      <ObjectAddonModal
        card={formCard}
        action="disconnect"
        addonId={opened?.addonId}
        open={isOpen("disconnectAddon")}
        onClose={closeForm}
      />
      <ReplaceDeviceModal card={formCard} open={isOpen("device")} onClose={closeForm} />
      <ReplaceSimModal card={formCard} open={isOpen("sim")} onClose={closeForm} />
      <AddSensorModal card={formCard} open={isOpen("addSensor")} onClose={closeForm} />
      <RemoveSensorModal
        objectId={formCard.id}
        sensor={opened?.sensor ?? null}
        open={isOpen("removeSensor")}
        onClose={closeForm}
      />
      {confirm.dialog}
    </>
  );
}

function ObjectScreen({ id }: { id: string }) {
  const card = useQuery({ queryKey: objectKey(id), queryFn: ({ signal }) => fetchObject(id, signal) });
  if (!card.data)
    return card.error ? <LoadError error={card.error} onRetry={() => void card.refetch()} /> : <Skeleton active />;
  return <ObjectView card={card.data} />;
}

export function ObjectPage() {
  const canRead = useCan("objects.read");
  const { id = "" } = useParams();
  return canRead ? <ObjectScreen key={id} id={id} /> : <NoAccess />;
}
