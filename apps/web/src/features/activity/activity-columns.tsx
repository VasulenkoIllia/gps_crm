import { activityActionLabel, activityActorLabel, type ActivityEvent } from "@gps_crm/shared";
import { Button } from "antd";
import { formatDateTime } from "../../lib/dayjs";
import { DateTimeText, type DataTableColumn } from "../../ui";
import { changeSummary, entityText } from "./activity-format";

export function activityColumns(onOpen: (event: ActivityEvent) => void): DataTableColumn<ActivityEvent>[] {
  return [
    {
      title: "Коли",
      dataIndex: "occurredAt",
      // A button, so the details open from the keyboard as well
      render: (_, event) => (
        <Button
          type="link"
          className="table-link"
          aria-label={`Подробиці: ${activityActionLabel(event.action)}, ${formatDateTime(event.occurredAt)}`}
          onClick={() => onOpen(event)}
        >
          <DateTimeText value={event.occurredAt} />
        </Button>
      ),
    },
    { title: "Хто", key: "actor", render: (_, event) => activityActorLabel(event) },
    { title: "Дія", dataIndex: "action", render: activityActionLabel },
    { title: "Запис", key: "entity", render: (_, event) => entityText(event) },
    { title: "Що змінилось", key: "changes", render: (_, event) => changeSummary(event) },
  ];
}
