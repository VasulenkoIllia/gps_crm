import { activityActionLabel, activityActorLabel, type Home, type RecentRecord } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Button, Skeleton } from "antd";
import { useState } from "react";
import { Link } from "react-router";
import { useCan } from "../../lib/session";
import { DateTimeText, EntityLink, LoadError, NoAccess, PageHeader, Panel } from "../../ui";
import { ObjectCreateDrawer } from "../objects/ObjectCreateDrawer";
import { GlobalSearch } from "../search/GlobalSearch";
import { SubscriberCreateDrawer } from "../subscribers/SubscriberCreateDrawer";
import { countText, fetchHome, HOME_KEY } from "./home.api";

function Counters({ counts }: { counts: Home["counts"] }) {
  const items = [
    { label: "Клієнти", to: "/subscribers", count: counts.clients },
    { label: "Активні об'єкти", to: "/objects?status=active", count: counts.activeObjects },
    { label: "Спливають договори", to: "/contracts?expiring=true", count: counts.expiringContracts },
  ];
  return (
    <div className="home-counters">
      {items.map(
        ({ label, to, count }) =>
          count && (
            <Link key={to} to={to} className="home-counter">
              <span className="list-meta">{label}</span>
              <span className="home-counter-value">{countText(count)}</span>
              <span className="home-counter-link">Відкрити список</span>
            </Link>
          ),
      )}
    </div>
  );
}

function recordLink(record: RecentRecord): string {
  return record.kind === "object" ? `/objects/${record.id}` : `/subscribers/${record.id}`;
}

function RecentRecords({ records }: { records: RecentRecord[] }) {
  return (
    <Panel title="Мої останні записи">
      {records.length > 0 ? (
        <ul className="simple-list">
          {records.map((record) => (
            <li key={`${record.kind}:${record.id}`}>
              <EntityLink to={recordLink(record)}>{record.name}</EntityLink>
              <div className="list-meta">
                {record.kind === "object"
                  ? `Об'єкт клієнта ${record.subscriberCode}`
                  : `Клієнт ${record.subscriberCode}`}
                {record.isArchived && ", в архіві"}, <DateTimeText value={record.changedAt} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="list-meta">Тут з'являться клієнти й об'єкти, які ви змінюватимете.</p>
      )}
    </Panel>
  );
}

function RecentActivity({ events }: { events: NonNullable<Home["recentActivity"]> }) {
  return (
    <Panel title="Останні зміни">
      {events.length > 0 ? (
        <ul className="simple-list">
          {events.map((event) => (
            <li key={event.id}>
              {activityActionLabel(event.action)}
              {event.entityLabel && `: ${event.entityLabel}`}
              <div className="list-meta">
                <DateTimeText value={event.occurredAt} />, {activityActorLabel(event)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="list-meta">Змін ще немає</p>
      )}
      <Link to="/activity" className="panel-link">
        Увесь журнал
      </Link>
    </Panel>
  );
}

function QuickActions() {
  const canAddClient = useCan("subscribers.write");
  const canAddObject = useCan("objects.write");
  const [opened, setOpened] = useState<"client" | "object" | null>(null);
  if (!canAddClient && !canAddObject) return null;
  return (
    <div className="home-actions">
      {canAddClient && <Button onClick={() => setOpened("client")}>Новий клієнт</Button>}
      {canAddObject && <Button onClick={() => setOpened("object")}>Новий об'єкт</Button>}
      <SubscriberCreateDrawer open={opened === "client"} onClose={() => setOpened(null)} />
      <ObjectCreateDrawer open={opened === "object"} onClose={() => setOpened(null)} />
    </div>
  );
}

// search-exports.md B: the start page of stage 1 instead of a dashboard (D24)
function HomeScreen() {
  // Fresh on every visit: the page shows what the person changed a moment ago on another one
  const home = useQuery({ queryKey: HOME_KEY, queryFn: ({ signal }) => fetchHome(signal), staleTime: 0 });
  return (
    <>
      <PageHeader title="Головна" />
      <Panel>
        <GlobalSearch isLarge />
        <QuickActions />
      </Panel>
      {home.error && <LoadError error={home.error} onRetry={() => void home.refetch()} />}
      {!home.data && !home.error && <Skeleton active />}
      {home.data && (
        <>
          <Counters counts={home.data.counts} />
          <div className="panel-grid">
            <RecentRecords records={home.data.recentRecords} />
            {home.data.recentActivity && <RecentActivity events={home.data.recentActivity} />}
          </div>
        </>
      )}
    </>
  );
}

export function HomePage() {
  const canRead = useCan("subscribers.read");
  return canRead ? <HomeScreen /> : <NoAccess />;
}
