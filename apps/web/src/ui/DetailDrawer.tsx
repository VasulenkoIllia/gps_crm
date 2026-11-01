import { Drawer, Grid } from "antd";
import type { ReactNode } from "react";

const DRAWER_WIDTH_PX = 520;

interface DetailDrawerProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

// A quick look that keeps the list behind it: 05-ui-standard.md §5.5
export function DetailDrawer({ title, open, onClose, children }: DetailDrawerProps) {
  const isPhone = Grid.useBreakpoint().md === false;
  return (
    <Drawer title={title} open={open} onClose={onClose} size={isPhone ? "100%" : DRAWER_WIDTH_PX} destroyOnHidden>
      {children}
    </Drawer>
  );
}
