import { Button, Tabs } from "antd";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useCan } from "../../lib/session";
import { NoAccess, PageHeader, Panel } from "../../ui";
import { DevicesTab } from "./DevicesTab";
import { SensorsTab } from "./SensorsTab";
import { SimsTab } from "./SimsTab";

const TAB_PARAM = "tab";
const TABS = [
  { key: "devices", label: "Трекери", add: "Новий трекер", content: DevicesTab },
  { key: "sims", label: "SIM-картки", add: "Нова SIM-картка", content: SimsTab },
  { key: "sensors", label: "Датчики", add: "Новий датчик", content: SensorsTab },
] as const;
const [FIRST_TAB] = TABS;

function EquipmentScreen() {
  const [params, setParams] = useSearchParams();
  const [isAdding, setAdding] = useState(false);
  const canWrite = useCan("equipment.write");
  const tab = TABS.find(({ key }) => key === params.get(TAB_PARAM)) ?? FIRST_TAB;
  const Active = tab.content;
  // Inside the tab and not under the tabs: the panel is where a screen reader lands after choosing one
  const active = <Active isAdding={isAdding} onAddClosed={() => setAdding(false)} />;

  return (
    <>
      <PageHeader
        title="Обладнання та SIM"
        subtitle="Весь запас: те, що стоїть на об'єктах, і те, що чекає встановлення"
        actions={
          canWrite && (
            <Button type="primary" onClick={() => setAdding(true)}>
              {tab.add}
            </Button>
          )
        }
      />
      <Panel>
        <Tabs
          activeKey={tab.key}
          items={TABS.map(({ key, label }) => (key === tab.key ? { key, label, children: active } : { key, label }))}
          // A new tab starts from its whole list: the filter of the last one means nothing here
          onChange={(next) => setParams({ [TAB_PARAM]: next }, { replace: true })}
        />
      </Panel>
    </>
  );
}

export function EquipmentPage() {
  const canRead = useCan("equipment.read");
  return canRead ? <EquipmentScreen /> : <NoAccess />;
}
