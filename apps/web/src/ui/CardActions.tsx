import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, type GetRef, type MenuProps } from "antd";
import { useRef, useState } from "react";
import type { RowAction } from "./RowActions";

const SHOWN_AS_BUTTONS = 2;

interface CardActionsProps<K extends string> {
  // Goes into the name of «Ще» after its visible word, «Ще: …», so a voice command by the word finds it (WCAG 2.5.3)
  rowName: string;
  // In the order of need: the first two stand as buttons, the rest wait under «Ще» (05-ui-standard.md §5.2)
  actions: RowAction<K>[];
  onAction: (key: K) => void;
}

// The head of a card: the same two buttons and «Ще» in a client and an object (manual test 05.11.2026)
export function CardActions<K extends string>({ rowName, actions, onAction }: CardActionsProps<K>) {
  const more = useRef<GetRef<typeof Button>>(null);
  const [isOpen, setOpen] = useState(false);
  if (actions.length === 0) return null;
  const shown = actions.slice(0, SHOWN_AS_BUTTONS);
  const rest = actions.slice(SHOWN_AS_BUTTONS);
  const items = rest.map(({ key, label }) => ({ key, label }));
  const choose: MenuProps["onClick"] = ({ key }) => {
    // As in a row: a form hands the focus back to what held it, and a menu item is gone by then
    more.current?.focus();
    onAction(key as K);
  };
  return (
    <div className="detail-actions">
      {shown.map(({ key, label }) => (
        <Button key={key} onClick={() => onAction(key)}>
          {label}
        </Button>
      ))}
      {rest.length > 0 && (
        <Dropdown trigger={["click"]} open={isOpen} onOpenChange={setOpen} menu={{ items, onClick: choose }}>
          <Button ref={more} aria-label={`Ще: ${rowName}`} aria-haspopup="menu" aria-expanded={isOpen}>
            Ще <DownOutlined />
          </Button>
        </Dropdown>
      )}
    </div>
  );
}
