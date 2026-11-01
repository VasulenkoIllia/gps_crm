import { Drawer, Form, Grid } from "antd";
import type { ReactNode } from "react";
import { FormAlert } from "./FormAlert";
import { useFormShell, type FormShellProps } from "./useFormShell";

const DRAWER_WIDTH_PX = 640;

interface FormDrawerProps<T> extends FormShellProps<T> {
  title: string;
  error?: unknown;
  children: ReactNode;
}

// A long form, typed with the list still behind it: 05-ui-standard.md §5.4
export function FormDrawer<T>(props: FormDrawerProps<T>) {
  const { title, open, error, children } = props;
  const { askToClose, footer, formProps } = useFormShell(props);
  const isPhone = Grid.useBreakpoint().md === false;

  return (
    <Drawer
      title={title}
      open={open}
      onClose={askToClose}
      size={isPhone ? "100%" : DRAWER_WIDTH_PX}
      destroyOnHidden
      footer={<div className="form-drawer-footer">{footer}</div>}
    >
      <FormAlert error={error} scrollsToView />
      <Form {...formProps}>{children}</Form>
    </Drawer>
  );
}
