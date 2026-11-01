import { activityActionLabel, activityActorLabel, type ActivityEvent } from "@gps_crm/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { formatDateTime } from "../../lib/dayjs";
import { useCan } from "../../lib/session";
import { useUrlFilters } from "../../lib/url-filters";
import { DataTable, DateTimeText, NoAccess, NothingFound, PageHeader, Panel, type DataTableColumn } from "../../ui";
import { ACTIVITY_FILTER_KEYS, ACTIVITY_KEY, fetchActivityPage } from "./activity.api";
import { changeSummary, entityText } from "./activity-format";
import { ActivityDetails } from "./ActivityDetails";
import { ActivityFilters } from "./ActivityFilters";

function buildColumns(onOpen: (event: ActivityEvent) => void): DataTableColumn<ActivityEvent>[] {
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

function ActivityScreen() {
  const { filters, hasFilters, setFilter, resetFilters } = useUrlFilters(ACTIVITY_FILTER_KEYS);
  const [opened, setOpened] = useState<ActivityEvent | null>(null);
  const [resetCount, setResetCount] = useState(0);

  const events = useInfiniteQuery({
    queryKey: [...ACTIVITY_KEY, filters],
    queryFn: ({ pageParam, signal }) => fetchActivityPage(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const rows = useMemo(() => events.data?.pages.flatMap((page) => page.items), [events.data]);
  const columns = useMemo(() => buildColumns(setOpened), []);

  // The count clears what the fields hold unapplied, which the address does not know of
  function reset() {
    resetFilters();
    setResetCount((count) => count + 1);
  }

  return (
    <>
      <PageHeader title="Журнал дій" subtitle="Хто, коли і що змінив" />
      <Panel>
        <ActivityFilters
          key={resetCount}
          filters={filters}
          hasFilters={hasFilters}
          onChange={setFilter}
          onReset={reset}
        />
        <DataTable
          rows={rows}
          columns={columns}
          rowKey="id"
          error={events.error}
          empty={hasFilters ? <NothingFound onReset={reset} /> : "Подій ще немає"}
          onRetry={() => void events.refetch()}
          hasMore={events.hasNextPage}
          isLoadingMore={events.isFetchingNextPage}
          onLoadMore={() => void events.fetchNextPage()}
        />
      </Panel>
      <ActivityDetails event={opened} onClose={() => setOpened(null)} />
    </>
  );
}

export function ActivityPage() {
  const canRead = useCan("activity.read");
  return canRead ? <ActivityScreen /> : <NoAccess />;
}
