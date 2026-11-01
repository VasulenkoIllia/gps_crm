import { activityEntityLabel, type ArchiveBatch } from "@gps_crm/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { useMemo, useState } from "react";
import { useCan } from "../../lib/session";
import {
  ConfirmAction,
  DataTable,
  DateTimeText,
  EmptyValue,
  errorMessage,
  NoAccess,
  PageHeader,
  Panel,
  type DataTableColumn,
} from "../../ui";
import { REFERENCES_KEY } from "../references/references.api";
import { ACTIVITY_KEY, ARCHIVE_KEY, fetchArchivePage, restoreBatch } from "./activity.api";

function buildColumns(onRestore: (batch: ArchiveBatch) => void): DataTableColumn<ArchiveBatch>[] {
  return [
    { title: "Що в архіві", dataIndex: "label" },
    { title: "Вид запису", dataIndex: "entityType", render: activityEntityLabel },
    { title: "Записів", dataIndex: "itemCount", align: "right" },
    { title: "Коли", dataIndex: "archivedAt", render: (value: string) => <DateTimeText value={value} /> },
    { title: "Хто", dataIndex: "archivedByName", render: (value: string | null) => value ?? <EmptyValue /> },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, batch) => (
        <Button aria-label={`Відновити: ${batch.label}`} onClick={() => onRestore(batch)}>
          Відновити
        </Button>
      ),
    },
  ];
}

function ArchiveScreen() {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [restoring, setRestoring] = useState<ArchiveBatch | null>(null);

  const batches = useInfiniteQuery({
    queryKey: ARCHIVE_KEY,
    queryFn: ({ pageParam, signal }) => fetchArchivePage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const rows = useMemo(() => batches.data?.pages.flatMap((page) => page.items), [batches.data]);
  const columns = useMemo(() => buildColumns(setRestoring), []);

  const restore = useMutation({
    mutationFn: (batch: ArchiveBatch) => restoreBatch(batch.id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ARCHIVE_KEY });
      void client.invalidateQueries({ queryKey: ACTIVITY_KEY });
      void client.invalidateQueries({ queryKey: REFERENCES_KEY });
      setRestoring(null);
      void message.success("Записи відновлено");
    },
    // Says what stands in the way (activity.md §10). The dialog goes: the package may be gone, and someone else's restore
    // would otherwise leave it asking about a row the list no longer has
    onError: (error) => {
      void client.invalidateQueries({ queryKey: ARCHIVE_KEY });
      setRestoring(null);
      void message.error(errorMessage(error));
    },
  });

  return (
    <>
      <PageHeader title="Архів" subtitle="Заархівовані записи повертаються пакетом" />
      <Panel>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey="id"
          error={batches.error}
          empty="В архіві поки нічого немає"
          onRetry={() => void batches.refetch()}
          hasMore={batches.hasNextPage}
          isLoadingMore={batches.isFetchingNextPage}
          onLoadMore={() => void batches.fetchNextPage()}
        />
      </Panel>
      <ConfirmAction
        title={`Відновити: ${restoring?.label ?? ""}?`}
        consequence="Усі записи цього пакета повернуться до роботи."
        actionLabel="Відновити"
        isDanger={false}
        open={restoring !== null}
        isPending={restore.isPending}
        onConfirm={() => restoring && restore.mutate(restoring)}
        onClose={() => setRestoring(null)}
      />
    </>
  );
}

export function ArchivePage() {
  const canArchive = useCan("records.archive");
  return canArchive ? <ArchiveScreen /> : <NoAccess />;
}
