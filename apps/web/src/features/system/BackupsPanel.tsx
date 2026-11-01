import type { BackupStatus } from "@gps_crm/shared";
import { formatBytes } from "../../lib/format";
import { DateTimeText, EmptyValue, FactList, Panel } from "../../ui";
import { VerdictTag } from "./VerdictTag";

export function BackupsPanel({ backups }: { backups: BackupStatus }) {
  const { dump, restoreCheck } = backups;
  return (
    <Panel title="Бекапи">
      <div className="fact-columns">
        <div>
          <VerdictTag verdict={dump} />
          <FactList
            items={[
              { label: "Остання резервна копія", value: <DateTimeText value={dump.lastOkAt} /> },
              { label: "Останній запуск", value: <DateTimeText value={dump.finishedAt} /> },
              { label: "Розмір", value: dump.dumpBytes === null ? <EmptyValue /> : formatBytes(dump.dumpBytes) },
              { label: "Копій на сервері", value: dump.copies ?? <EmptyValue /> },
            ]}
          />
        </div>
        <div>
          <VerdictTag verdict={restoreCheck} />
          <FactList
            items={[
              { label: "Остання перевірка відновлення", value: <DateTimeText value={restoreCheck.lastOkAt} /> },
              { label: "Таблиць у копії", value: restoreCheck.tables ?? <EmptyValue /> },
            ]}
          />
        </div>
      </div>
    </Panel>
  );
}
