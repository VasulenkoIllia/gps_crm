import { Button } from "antd";
import { PageHeader, Panel, THEME_COLORS } from "../../ui";
import { ApiStatusPanel } from "./ApiStatusPanel";
import { ShowcaseForm } from "./ShowcaseForm";

const SWATCHES = [
  { name: "Основний", color: THEME_COLORS.primary },
  { name: "Фон сторінки", color: THEME_COLORS.page },
  { name: "Поверхня", color: THEME_COLORS.surface },
  { name: "Текст", color: THEME_COLORS.ink },
  { name: "Успіх", color: THEME_COLORS.good },
  { name: "Помилка", color: THEME_COLORS.critical },
];

export function ShowcasePage() {
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

      <Panel title="Стан API">
        <ApiStatusPanel />
      </Panel>

      <Panel title="Форма">
        <ShowcaseForm />
      </Panel>
    </>
  );
}
