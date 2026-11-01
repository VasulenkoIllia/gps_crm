import type { ActivityEvent } from "@gps_crm/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { DataTable } from "../../ui";
import { activityColumns } from "../activity/activity-columns";
import { ACTIVITY_KEY } from "../activity/activity.api";
import { ActivityDetails } from "../activity/ActivityDetails";
import { fetchClientActivity } from "./subscribers.api";

// D53: everything that happened to this client and what hangs off it
export function ClientActivityTab({ subscriberId }: { subscriberId: string }) {
  const [opened, setOpened] = useState<ActivityEvent | null>(null);
  const events = useInfiniteQuery({
    queryKey: [...ACTIVITY_KEY, "client", subscriberId],
    queryFn: ({ pageParam, signal }) => fetchClientActivity(subscriberId, pageParam, signal),
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
