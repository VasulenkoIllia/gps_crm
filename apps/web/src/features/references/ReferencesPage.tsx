import { REFERENCE_KINDS, type ReferenceKind } from "@gps_crm/shared";
import { Button, Tabs } from "antd";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { useCan } from "../../lib/session";
import { NoAccess, PageHeader, Panel } from "../../ui";
import { AddonsTab } from "./AddonsTab";
import type { TabProps } from "./ReferenceTab";
import { REFERENCE_TEXTS } from "./reference-texts";
import { ServersTab } from "./ServersTab";
import { SimPlansTab } from "./SimPlansTab";
import { SimpleTab } from "./SimpleTab";
import { TariffsTab } from "./TariffsTab";

const TAB_PARAM = "tab";
const FIRST_TAB: ReferenceKind = "programs";
const TAB_ITEMS = REFERENCE_KINDS.map((kind) => ({ key: kind, label: REFERENCE_TEXTS[kind].tab }));

function ActiveTab({ kind, ...tab }: TabProps & { kind: ReferenceKind }) {
  switch (kind) {
    case "servers":
      return <ServersTab {...tab} />;
    case "tariffs":
      return <TariffsTab {...tab} />;
    case "addons":
      return <AddonsTab {...tab} />;
    case "sim-plans":
      return <SimPlansTab {...tab} />;
    default:
      return <SimpleTab kind={kind} {...tab} />;
  }
}

function toKind(value: string | null): ReferenceKind {
  return REFERENCE_KINDS.find((kind) => kind === value) ?? FIRST_TAB;
}

function ReferencesScreen() {
  const [params, setParams] = useSearchParams();
  const [isAdding, setAdding] = useState(false);
  const canManage = useCan("references.manage");
  const kind = toKind(params.get(TAB_PARAM));
  const openForm = () => setAdding(true);
  const closeForm = () => setAdding(false);

  // Inside the tab and not under the tabs: the panel is where a screen reader lands after choosing one
  const active = (
    <ActiveTab kind={kind} isAdding={isAdding} canManage={canManage} onAdd={openForm} onAddClosed={closeForm} />
  );

  return (
    <>
      <PageHeader
        title="Довідники"
        subtitle="Деактивовані записи повертаються з розділу «Архів»"
        actions={
          canManage && (
            <Button type="primary" onClick={openForm}>
              {REFERENCE_TEXTS[kind].add}
            </Button>
          )
        }
      />
      <Panel>
        <Tabs
          activeKey={kind}
          items={TAB_ITEMS.map((item) => (item.key === kind ? { ...item, children: active } : item))}
          // A new tab starts from its whole list: the filter of the last one means nothing here
          onChange={(next) => setParams({ [TAB_PARAM]: next }, { replace: true })}
        />
      </Panel>
    </>
  );
}

export function ReferencesPage() {
  const canRead = useCan("subscribers.read");
  return canRead ? <ReferencesScreen /> : <NoAccess />;
}
