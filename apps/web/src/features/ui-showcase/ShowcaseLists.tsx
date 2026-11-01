import { Button } from "antd";
import { useState } from "react";
import {
  Code,
  DateFilter,
  DetailDrawer,
  EmptyValue,
  FactList,
  FilterBar,
  FilterSelect,
  NothingFound,
  Panel,
  StatusTag,
} from "../../ui";

const SAMPLE_OPTIONS = [
  { value: "first", label: "Перший" },
  { value: "second", label: "Другий" },
];

const noop = () => undefined;

export function ShowcaseLists() {
  const [choice, setChoice] = useState<string>();
  const [date, setDate] = useState<string>();
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const reset = () => {
    setChoice(undefined);
    setDate(undefined);
  };

  return (
    <>
      <Panel title="Фільтри">
        <FilterBar hasFilters={Boolean(choice || date)} onReset={reset}>
          <DateFilter label="Від" value={date} onChange={setDate} />
          <FilterSelect label="Список" value={choice} options={SAMPLE_OPTIONS} onChange={setChoice} />
          <FilterSelect label="Помилка" value={undefined} options={[]} hasError onChange={noop} />
        </FilterBar>
        <NothingFound onReset={reset} />
      </Panel>

      <Panel title="Факти, коди, порожнє значення">
        <StatusTag status={{ label: "Потребує уваги", tone: "warning" }} />
        <FactList
          items={[
            { label: "Звичайне значення", value: "Текст" },
            { label: "Код", value: <Code>sha-0123456</Code> },
            { label: "Немає значення", value: <EmptyValue /> },
          ]}
        />
      </Panel>

      <Panel title="Швидкий перегляд">
        <Button onClick={() => setDrawerOpen(true)}>Відкрити</Button>
        <DetailDrawer title="Подробиці" open={isDrawerOpen} onClose={() => setDrawerOpen(false)}>
          <FactList items={[{ label: "Поле", value: "Значення" }]} />
        </DetailDrawer>
      </Panel>
    </>
  );
}
