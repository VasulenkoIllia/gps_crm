import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import { useCan } from "../../lib/session";
import { DateTimeText, FormAlert, LoadError, NoAccess, PageHeader } from "../../ui";
import { BackupsPanel } from "./BackupsPanel";
import { JobsPanel } from "./JobsPanel";
import { RecentActivityPanel } from "./RecentActivityPanel";
import { QueuesPanel, StoragePanel, VersionPanel } from "./StatePanels";
import {
  fetchJobs,
  fetchSystemStatus,
  SYSTEM_JOBS_KEY,
  SYSTEM_KEY,
  SYSTEM_REFRESH_MS,
  SYSTEM_STATUS_KEY,
} from "./system.api";

function SystemScreen() {
  const client = useQueryClient();
  const canReadActivity = useCan("activity.read");
  const status = useQuery({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: ({ signal }) => fetchSystemStatus(signal),
    refetchInterval: SYSTEM_REFRESH_MS,
  });
  const jobs = useQuery({
    queryKey: SYSTEM_JOBS_KEY,
    queryFn: ({ signal }) => fetchJobs(signal),
    refetchInterval: SYSTEM_REFRESH_MS,
  });
  const refresh = () => void client.invalidateQueries({ queryKey: SYSTEM_KEY });
  const retryStatus = () => void status.refetch();
  const retryJobs = () => void jobs.refetch();

  const { data } = status;
  const header = (
    <PageHeader
      title="Система"
      subtitle={
        data && (
          <>
            Перевірено: <DateTimeText value={data.checkedAt} />
          </>
        )
      }
      actions={
        <Button loading={status.isFetching} onClick={refresh}>
          Оновити
        </Button>
      }
    />
  );

  if (!data) {
    return (
      <>
        {header}
        {status.error ? <LoadError error={status.error} onRetry={retryStatus} /> : <Skeleton active />}
      </>
    );
  }

  return (
    <>
      {header}
      {/* The blocks stay: a refresh that failed takes nothing away, and it must not pass for a fresh reading */}
      <FormAlert error={status.error} />
      <BackupsPanel backups={data.backups} />
      <JobsPanel jobs={jobs.data?.items} error={jobs.error} onRetry={retryJobs} />
      <QueuesPanel state={data.queueState} queues={data.queues} onRetry={retryStatus} />
      <div className="panel-grid">
        <div>
          <StoragePanel database={data.database} disk={data.disk} />
          <VersionPanel version={data.version} />
        </div>
        {canReadActivity && <RecentActivityPanel />}
      </div>
    </>
  );
}

export function SystemPage() {
  const canRead = useCan("system.read");
  return canRead ? <SystemScreen /> : <NoAccess />;
}
