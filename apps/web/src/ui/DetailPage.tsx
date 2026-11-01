import { Tabs } from "antd";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "./PageHeader";
import { Panel } from "./Panel";

const TAB_PARAM = "tab";

export interface DetailTab {
  key: string;
  label: string;
  // A function, so only the open tab renders: each loads its own data (05-ui-standard.md §5.2)
  render: () => ReactNode;
}

interface DetailPageProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  facts: ReactNode;
  tabs: DetailTab[];
}

export function DetailPage({ title, subtitle, actions, facts, tabs }: DetailPageProps) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get(TAB_PARAM);
  const active = tabs.find((tab) => tab.key === wanted) ?? tabs[0];

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <Panel>
        <div className="detail-facts">{facts}</div>
      </Panel>
      <Panel>
        <Tabs
          activeKey={active?.key}
          // In the tab panel itself, so a screen reader finds the content the tab points to
          items={tabs.map(({ key, label, render }) => ({
            key,
            label,
            children: key === active?.key ? render() : null,
          }))}
          onChange={(tab) => setParams({ [TAB_PARAM]: tab }, { replace: true })}
        />
      </Panel>
    </>
  );
}
