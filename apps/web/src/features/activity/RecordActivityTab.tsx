import type { ActivityEvent, ActivityList } from "@gps_crm/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DataTable } from "../../ui";
import { activityColumns } from "./activity-columns";
import { ActivityDetails } from "./ActivityDetails";

interface RecordActivityTabProps {
  queryKey: string[];
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<ActivityList>;
}

// The journal of one record inside its card (D53)
export function RecordActivityTab({ queryKey, fetchPage }: RecordActivityTabProps) {
  const [opened, setOpened] = useState<ActivityEvent | null>(null);
  const events = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam, signal }) => fetchPage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const rows = useMemo(() => events.data?.pages.flatMap((page) => page.items), [events.data]);
  const columns = useMemo(() => activityColumns(setOpened), []);

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey="id"
        error={events.error}
        empty="Подій ще немає"
        onRetry={() => void events.refetch()}
        hasMore={events.hasNextPage}
        isLoadingMore={events.isFetchingNextPage}
        onLoadMore={() => void events.fetchNextPage()}
      />
      <ActivityDetails event={opened} onClose={() => setOpened(null)} />
    </>
  );
}
