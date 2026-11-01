import { activityActionLabel, activityActorLabel } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";
import { Link } from "react-router";
import { DateTimeText, FormAlert, LoadError, Panel } from "../../ui";
import { fetchRecentActivity, SYSTEM_RECENT_KEY, SYSTEM_REFRESH_MS } from "./system.api";

export function RecentActivityPanel() {
  const recent = useQuery({
    queryKey: SYSTEM_RECENT_KEY,
    queryFn: ({ signal }) => fetchRecentActivity(signal),
    refetchInterval: SYSTEM_REFRESH_MS,
  });

  if (!recent.data) {
    return (
      <Panel title="Останні дії">
        {recent.error ? <LoadError error={recent.error} onRetry={() => void recent.refetch()} /> : <Skeleton active />}
      </Panel>
    );
  }

  return (
    <Panel title="Останні дії">
      <FormAlert error={recent.error} />
      {recent.data.items.length > 0 ? (
        <ul className="simple-list">
          {recent.data.items.map((event) => (
            <li key={event.id}>
              {activityActionLabel(event.action)}
              <div className="list-meta">
                <DateTimeText value={event.occurredAt} />, {activityActorLabel(event)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="list-meta">Дій ще немає</p>
      )}
      <Link to="/activity" className="panel-link">
        Увесь журнал
      </Link>
    </Panel>
  );
}
