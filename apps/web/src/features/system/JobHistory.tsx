import { JOB_RUN_RESULTS, type JobListItem, type JobRun } from "@gps_crm/shared";
import { DateTimeText, DetailDrawer, EmptyValue, FactList, StatusTag } from "../../ui";

const TRIGGER_LABELS: Record<JobRun["trigger"], string> = { schedule: "За розкладом", manual: "Вручну" };

function RunRow({ run }: { run: JobRun }) {
  return (
    <li>
      <StatusTag status={run.isSuccess ? JOB_RUN_RESULTS.success : JOB_RUN_RESULTS.failure} />
      <DateTimeText value={run.finishedAt} />
      <span className="list-meta"> {TRIGGER_LABELS[run.trigger]}</span>
      {run.skippedItems > 0 && <div className="list-meta">Пропущено елементів: {run.skippedItems}</div>}
      {run.error && <div className="list-meta">{run.error}</div>}
    </li>
  );
}

export function JobHistory({ job, onClose }: { job: JobListItem | null; onClose: () => void }) {
  return (
    <DetailDrawer title={job?.title ?? ""} open={job !== null} onClose={onClose}>
      {job && (
        <>
          <FactList
            items={[
              { label: "Розклад", value: job.scheduleLabel },
              { label: "Останній успіх", value: <DateTimeText value={job.lastSuccessAt} /> },
              { label: "Збоїв поспіль", value: job.failureStreak },
              { label: "Остання помилка", value: job.lastError ?? <EmptyValue /> },
            ]}
          />
          <h2 className="sub-heading">Останні запуски</h2>
          {job.runs.length > 0 ? (
            <ul className="simple-list">
              {job.runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
          ) : (
            <p className="list-meta">Запусків ще не було</p>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
