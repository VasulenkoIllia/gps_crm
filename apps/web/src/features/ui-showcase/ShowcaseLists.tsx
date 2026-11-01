import { Button } from "antd";
import { useState } from "react";
import {
  Code,
  DateFilter,
  DateInput,
  DateText,
  DetailDrawer,
  DictSelect,
  EmptyValue,
  EntityLink,
  ExternalLink,
  FactList,
  FileInput,
  FilterBar,
  FilterSelect,
  Money,
  MoneyInput,
  NothingFound,
  Panel,
  Phone,
  RemoteSelect,
  RowActions,
  SearchField,
  StatusTag,
} from "../../ui";

const SAMPLE_OPTIONS = [
  { value: "first", label: "Перший" },
  { value: "second", label: "Другий" },
];

const DICT_OPTIONS = [
  { value: "first", label: "Активний запис", isActive: true },
  { value: "second", label: "Деактивований, обраний раніше", isActive: false },
  { value: "third", label: "Деактивований, у виборі не з'явиться", isActive: false },
];
const SAMPLE_AMOUNT_KOP = 1_234_550;
const SAMPLE_DATE = "2027-03-01";
const SAMPLE_ACTIONS = [{ key: "edit", label: "Змінити" }];

const SAMPLE_PHONE = "+380501112233";

const noop = () => undefined;
const searchSamples = (text: string) =>
  Promise.resolve(SAMPLE_OPTIONS.filter(({ label }) => label.toLowerCase().includes(text.toLowerCase())));

export function ShowcaseLists() {
  const [choice, setChoice] = useState<string>();
  const [date, setDate] = useState<string>();
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [formDate, setFormDate] = useState<string | undefined>(SAMPLE_DATE);
  const [dictValue, setDictValue] = useState("second");
  const [search, setSearch] = useState<string>();
  const [remote, setRemote] = useState<string>();
  const [file, setFile] = useState<File | null>(null);
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

      <Panel title="Гроші, дати, вибір зі списку">
        <FactList
          items={[
            { label: "Сума", value: <Money kop={SAMPLE_AMOUNT_KOP} /> },
            { label: "Дата", value: <DateText value={SAMPLE_DATE} /> },
            { label: "Дії рядка", value: <RowActions rowName="Запис" actions={SAMPLE_ACTIONS} onAction={noop} /> },
          ]}
        />
        <div className="showcase-form">
          <MoneyInput aria-label="Сума" placeholder="0,00" />
          <DateInput aria-label="Дата" className="form-control-wide" value={formDate} onChange={setFormDate} />
          <DictSelect<string>
            aria-label="Вибір з довідника"
            value={dictValue}
            options={DICT_OPTIONS}
            onChange={setDictValue}
          />
        </div>
      </Panel>

      <Panel title="Пошук на сервері, посилання, файл">
        <FilterBar hasFilters={Boolean(search || remote)} onReset={noop}>
          <SearchField label="Пошук" placeholder="Із затримкою 300 мс" value={search} onChange={setSearch} />
        </FilterBar>
        <FactList
          items={[
            { label: "Телефон", value: <Phone value={SAMPLE_PHONE} /> },
            { label: "Запис", value: <EntityLink to="/ui">Назва запису</EntityLink> },
            { label: "Зовнішнє посилання", value: <ExternalLink href="https://example.test">Відкрити</ExternalLink> },
          ]}
        />
        <div className="showcase-form">
          <RemoteSelect
            aria-label="Вибір із серверного пошуку"
            name="showcase"
            value={remote}
            search={searchSamples}
            onChange={setRemote}
          />
          <FileInput label="Файл" accept=".pdf" value={file} onChange={setFile} />
        </div>
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
