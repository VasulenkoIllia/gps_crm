import type { SystemStatus, SystemVerdict } from "@gps_crm/shared";
import { formatBytes } from "../../lib/format";
import { Code, DataTable, DateTimeText, EmptyValue, FactList, Panel, type DataTableColumn } from "../../ui";
import { VerdictTag } from "./VerdictTag";

type QueueRow = SystemStatus["queues"][number];

const QUEUE_COLUMNS: DataTableColumn<QueueRow>[] = [
  { title: "Черга", dataIndex: "label" },
  { title: "Очікує", dataIndex: "waiting", align: "right" },
  { title: "Виконується", dataIndex: "active", align: "right" },
  { title: "Відкладено", dataIndex: "deferred", align: "right" },
  { title: "Зі збоєм", dataIndex: "failed", align: "right" },
];

interface QueuesPanelProps {
  state: SystemVerdict;
  queues: QueueRow[];
  onRetry: () => void;
}

export function QueuesPanel({ state, queues, onRetry }: QueuesPanelProps) {
  return (
    <Panel title="Черги">
      <div className="panel-lead">
        <VerdictTag verdict={state} />
      </div>
      <DataTable
        rows={queues}
        columns={QUEUE_COLUMNS}
        rowKey="name"
        error={null}
        empty="Черг ще немає"
        onRetry={onRetry}
      />
    </Panel>
  );
}

function diskText(disk: SystemStatus["disk"]) {
  if (disk.usedPercent === null || disk.freeBytes === null || disk.totalBytes === null) return <EmptyValue />;
  return `Зайнято ${disk.usedPercent} %, вільно ${formatBytes(disk.freeBytes)} із ${formatBytes(disk.totalBytes)}`;
}

export function StoragePanel({ database, disk }: Pick<SystemStatus, "database" | "disk">) {
  return (
    <Panel title="База й диск">
      <VerdictTag verdict={disk} />
      <FactList
        items={[
          { label: "Диск", value: diskText(disk) },
          { label: "Розмір бази", value: formatBytes(database.sizeBytes) },
          ...database.tables.map((table) => ({ label: table.name, value: formatBytes(table.sizeBytes) })),
        ]}
      />
    </Panel>
  );
}

export function VersionPanel({ version }: { version: SystemStatus["version"] }) {
  return (
    <Panel title="Версія">
      <FactList
        items={[{ label: "Зараз працює", value: version.current ? <Code>{version.current}</Code> : <EmptyValue /> }]}
      />
      {version.deployments.length > 0 && (
        <>
          <h3 className="sub-heading">Останні оновлення</h3>
          <ul className="simple-list">
            {version.deployments.map((deployment) => (
              <li key={deployment.deployedAt}>
                <DateTimeText value={deployment.deployedAt} />: <Code>{deployment.version}</Code>
                {deployment.previousVersion && (
                  <div className="list-meta">
                    Попередня: <Code>{deployment.previousVersion}</Code>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
