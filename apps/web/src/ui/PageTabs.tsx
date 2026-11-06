import { Grid, Select, Tabs, type TabsProps } from "antd";
import type { ReactNode } from "react";

export interface PageTab {
  key: string;
  label: string;
  // Only the open tab has its content: each loads its own data
  children?: ReactNode;
}

interface PageTabsProps {
  activeKey: string | undefined;
  items: PageTab[];
  onChange: (key: string) => void;
}

// On a phone the bar of tabs hid most of them past its edge without a hint (6 of 9 in «Довідники»): there a list names
// them all (manual test 05.11.2026). One Tabs at every width: a turn of the phone swaps only the bar, and the open tab
// keeps its forms and its place
export function PageTabs({ activeKey, items, onChange }: PageTabsProps) {
  const isPhone = Grid.useBreakpoint().md === false;
  const renderTabBar: TabsProps["renderTabBar"] = isPhone
    ? () => (
        <Select
          aria-label="Вкладка"
          className="page-tabs-select"
          value={activeKey}
          options={items.map(({ key, label }) => ({ value: key, label }))}
          onChange={onChange}
        />
      )
    : undefined;
  return <Tabs activeKey={activeKey} items={items} onChange={onChange} renderTabBar={renderTabBar} />;
}
