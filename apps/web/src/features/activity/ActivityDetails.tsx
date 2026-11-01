import { activityActionLabel, activityActorLabel, activityFieldLabel, type ActivityEvent } from "@gps_crm/shared";
import { Code, CopyButton, DateTimeText, DetailDrawer, EmptyValue, FactList, type Fact } from "../../ui";
import { entityText, formatActivityValue } from "./activity-format";

const code = (value: string | null) => (value ? <Code>{value}</Code> : <EmptyValue />);

function eventFacts(event: ActivityEvent): Fact[] {
  return [
    { label: "Коли", value: <DateTimeText value={event.occurredAt} /> },
    { label: "Хто", value: activityActorLabel(event) },
    { label: "Запис", value: entityText(event) },
    ...event.details.map(({ field, value }) => ({
      label: activityFieldLabel(field),
      value: formatActivityValue(value),
    })),
    { label: "IP", value: code(event.ip) },
    { label: "Номер запиту", value: code(event.requestId) },
  ];
}

function Changes({ event }: { event: ActivityEvent }) {
  return (
    <>
      <h2 className="sub-heading">Зміни</h2>
      <ul className="simple-list">
        {event.changes.map(({ field, before, after }) => (
          <li key={field}>
            <strong>{activityFieldLabel(field)}</strong>
            <div>Було: {formatActivityValue(before)}</div>
            <div>Стало: {formatActivityValue(after)}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ActivityDetails({ event, onClose }: { event: ActivityEvent | null; onClose: () => void }) {
  return (
    <DetailDrawer title={event ? activityActionLabel(event.action) : ""} open={event !== null} onClose={onClose}>
      {event && (
        <>
          <FactList items={eventFacts(event)} />
          {event.changes.length > 0 && <Changes event={event} />}
          {event.entityId && (
            <div className="drawer-actions">
              <CopyButton value={event.entityId} label="Скопіювати ID запису" />
            </div>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
