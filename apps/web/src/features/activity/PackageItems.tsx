import { activityActionLabel, isPackageEvent, type ActivityEvent } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Skeleton, type TableProps } from "antd";
import { LoadError } from "../../ui";
import { ACTIVITY_KEY, fetchPackageItems } from "./activity.api";

function itemCountOf(event: ActivityEvent): number | null {
  const count = event.details.find((detail) => detail.field === "itemCount")?.value;
  return typeof count === "number" ? count : null;
}

// D92: the records one line of a package stands for, read when the line opens
function PackageItems({ event }: { event: ActivityEvent }) {
  const batchId = event.entityId ?? "";
  const items = useQuery({
    queryKey: [...ACTIVITY_KEY, "package", batchId, event.action],
    queryFn: ({ signal }) => fetchPackageItems(batchId, event.action, signal),
    // A line opens only with the id of its batch (isPackageEvent); this keeps a broken one from asking for nothing
    enabled: batchId !== "",
  });

  if (items.isError) return <LoadError error={items.error} onRetry={() => void items.refetch()} />;
  if (batchId !== "" && items.isPending) return <Skeleton active title={false} paragraph={{ rows: 2 }} />;
  const lines = items.data?.items ?? [];
  if (lines.length === 0) return <p className="list-meta">Окремих дій цього пакета в журналі немає</p>;
  const total = itemCountOf(event);
  return (
    <>
      <ul className="simple-list package-items">
        {lines.map((line) => (
          <li key={line.id}>
            {activityActionLabel(line.action)}
            {line.entityLabel && `: ${line.entityLabel}`}
          </li>
        ))}
      </ul>
      {total !== null && total > lines.length && (
        <p className="list-meta">
          Показано {lines.length} з {total}
        </p>
      )}
    </>
  );
}

export const PACKAGE_EXPANDABLE: TableProps<ActivityEvent>["expandable"] = {
  rowExpandable: isPackageEvent,
  expandedRowRender: (event) => <PackageItems event={event} />,
};
