import { USER_STATUS_META } from "@gps_crm/shared";
import { Button } from "antd";
import { useState } from "react";
import {
  ConfirmAction,
  CopyButton,
  DataTable,
  DateTimeText,
  LoadError,
  NoAccess,
  PageHeader,
  Panel,
  StatusTag,
  THEME_COLORS,
  type DataTableColumn,
} from "../../ui";
import { ApiStatusPanel } from "./ApiStatusPanel";
import { ShowcaseForm } from "./ShowcaseForm";
import { ShowcaseLists } from "./ShowcaseLists";

const SWATCHES = [
  { name: "Основний", color: THEME_COLORS.primary },
  { name: "Фон сторінки", color: THEME_COLORS.page },
  { name: "Поверхня", color: THEME_COLORS.surface },
  { name: "Текст", color: THEME_COLORS.ink },
  { name: "Успіх", color: THEME_COLORS.good },
  { name: "Увага", color: THEME_COLORS.warning },
  { name: "Помилка", color: THEME_COLORS.critical },
];

interface SampleRow {
  id: string;
  name: string;
  seenAt: string | null;
}

const SAMPLE_ROWS: SampleRow[] = [
  { id: "1", name: "Перший рядок", seenAt: "2027-01-15T10:30:00.000Z" },
  { id: "2", name: "Другий рядок", seenAt: null },
];
const SAMPLE_COLUMNS: DataTableColumn<SampleRow>[] = [
  { title: "Назва", dataIndex: "name" },
  { title: "Дата", dataIndex: "seenAt", render: (value: string | null) => <DateTimeText value={value} /> },
];

function TableStates() {
  const noop = () => undefined;
  return (
    <>
      <DataTable rows={SAMPLE_ROWS} columns={SAMPLE_COLUMNS} rowKey="id" error={null} empty="" onRetry={noop} />
      <DataTable rows={undefined} columns={SAMPLE_COLUMNS} rowKey="id" error={null} empty="" onRetry={noop} />
      <DataTable rows={[]} columns={SAMPLE_COLUMNS} rowKey="id" error={null} empty="Записів ще немає" onRetry={noop} />
      <LoadError error={null} onRetry={noop} />
    </>
  );
}

export function ShowcasePage() {
  const [isConfirming, setConfirming] = useState(false);
  return (
    <>
      <PageHeader
        title="Вітрина інтерфейсу"
        subtitle="Тема, шаблон сторінки й форма, з яких будуються всі екрани"
        actions={
          <>
            <Button>Другорядна дія</Button>
            <Button type="primary">Головна дія</Button>
          </>
        }
      />

      <Panel title="Тема">
        <div className="swatches">
          {SWATCHES.map((swatch) => (
            <div key={swatch.name}>
              <div className="swatch-color" style={{ background: swatch.color }} />
              <div className="swatch-name">
                {swatch.name}: {swatch.color}
              </div>
            </div>
          ))}
        </div>
        <div className="showcase-actions">
          <Button type="primary">Зберегти</Button>
          <Button>Скасувати</Button>
          <Button disabled>Недоступно</Button>
          <Button loading>Зберігаю</Button>
        </div>
      </Panel>

      <Panel title="Статуси">
        <div className="showcase-actions">
          {Object.values(USER_STATUS_META).map((status) => (
            <StatusTag key={status.label} status={status} />
          ))}
        </div>
      </Panel>

      <Panel title="Таблиця: дані, завантаження, порожньо, помилка">
        <TableStates />
      </Panel>

      <ShowcaseLists />

      <Panel title="Дії">
        <div className="showcase-actions">
          <CopyButton value="Текст для копіювання" />
          <Button onClick={() => setConfirming(true)}>Небезпечна дія</Button>
        </div>
        <ConfirmAction
          title="Підтвердити дію?"
          consequence="Тут одне речення про наслідок."
          actionLabel="Підтвердити"
          open={isConfirming}
          isPending={false}
          onConfirm={() => setConfirming(false)}
          onClose={() => setConfirming(false)}
        />
      </Panel>

      <Panel title="Немає доступу">
        <NoAccess />
      </Panel>

      <Panel title="Стан API">
        <ApiStatusPanel />
      </Panel>

      <Panel title="Форма">
        <ShowcaseForm />
      </Panel>
    </>
  );
}
