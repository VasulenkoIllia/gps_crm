import { Form, Modal } from "antd";
import type { ReactNode } from "react";
import { FormAlert } from "./FormAlert";
import { useFormShell, type FormShellProps } from "./useFormShell";

interface FormModalProps<T> extends FormShellProps<T> {
  title: string;
  error?: unknown;
  children: ReactNode;
}

export function FormModal<T>(props: FormModalProps<T>) {
  const { title, open, error, children } = props;
  const { askToClose, footer, formProps } = useFormShell(props);

  return (
    <Modal title={title} open={open} onCancel={askToClose} destroyOnHidden footer={footer}>
      <FormAlert error={error} scrollsToView />
      <Form {...formProps}>{children}</Form>
    </Modal>
  );
}
