import { MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, type GetRef, type MenuProps } from "antd";
import { useRef, useState } from "react";

type MenuItem = NonNullable<MenuProps["items"]>[number];

export interface RowAction<K extends string> {
  key: K;
  label: string;
}

interface RowActionsProps<K extends string> {
  // Goes into the button's name: a screen reader has only that to tell one row from another (05-ui-standard.md §5.9)
  rowName: string;
  actions: RowAction<K>[];
  onAction: (key: K) => void;
}

export function RowActions<K extends string>({ rowName, actions, onAction }: RowActionsProps<K>) {
  const button = useRef<GetRef<typeof Button>>(null);
  const [isOpen, setOpen] = useState(false);
  if (actions.length === 0) return null;
  const items = actions.map(({ key, label }): MenuItem => ({ key, label }));
  const choose: MenuProps["onClick"] = ({ key }) => {
    // Before the action: a form hands the focus back to what held it, and a menu item is gone by then
    button.current?.focus();
    onAction(key as K);
  };
  return (
    <Dropdown trigger={["click"]} open={isOpen} onOpenChange={setOpen} menu={{ items, onClick: choose }}>
      {/* A plain title, not antd's Tooltip: between Dropdown and Button it costs the focus after Esc */}
      <Button
        ref={button}
        type="text"
        icon={<MoreOutlined />}
        title="Дії"
        aria-label={`Дії: ${rowName}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      />
    </Dropdown>
  );
}
