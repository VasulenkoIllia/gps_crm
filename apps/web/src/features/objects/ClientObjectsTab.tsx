import type { SubscriberCard } from "@gps_crm/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { listRows } from "../../lib/list-rows";
import { useCan } from "../../lib/session";
import { DataTable } from "../../ui";
import { CLIENT_OBJECT_COLUMNS } from "./object-columns";
import { ObjectCreateDrawer } from "./ObjectCreateDrawer";
import { fetchObjects, OBJECTS_KEY } from "./objects.api";

// A client in the archive took its objects along, and there they are found
export function ClientObjectsTab({ card }: { card: SubscriberCard }) {
  const navigate = useNavigate();
  const canCreate = useCan("objects.write") && !card.isArchived;
  const [isCreating, setCreating] = useState(false);
  const filters = useMemo(
    () => ({ subscriberId: card.id, ...(card.isArchived ? { archived: "true" } : {}) }),
    [card.id, card.isArchived],
  );
  const pages = useInfiniteQuery({
    queryKey: [...OBJECTS_KEY, "list", filters],
    queryFn: ({ pageParam, signal }) => fetchObjects({ filters, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const rows = useMemo(() => listRows(pages.data, pages.isPlaceholderData), [pages.data, pages.isPlaceholderData]);

  return (
    <>
      {canCreate && (
        <div className="tab-actions">
          <Button onClick={() => setCreating(true)}>Додати об'єкт</Button>
        </div>
      )}
      <DataTable
        rows={rows}
        columns={CLIENT_OBJECT_COLUMNS}
        rowKey="id"
        error={pages.error}
        empty="Об'єктів ще немає"
        onRetry={() => void pages.refetch()}
        hasMore={pages.hasNextPage}
        isLoadingMore={pages.isFetchingNextPage}
        onLoadMore={() => void pages.fetchNextPage()}
        onRowClick={(row) => void navigate(`/objects/${row.id}`)}
      />
      <ObjectCreateDrawer subscriberId={card.id} open={isCreating} onClose={() => setCreating(false)} />
    </>
  );
}
