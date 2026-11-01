import { App, Button, Form, Modal, type FormInstance } from "antd";
import { useId, type ReactNode } from "react";
import { FormAlert } from "./FormAlert";

interface FormModalProps<T> {
  title: string;
  submitLabel: string;
  open: boolean;
  form: FormInstance<T>;
  isSubmitting: boolean;
  error?: unknown;
  onSubmit: (values: T) => void;
  onClose: () => void;
  children: ReactNode;
}

export function FormModal<T>(props: FormModalProps<T>) {
  const { title, submitLabel, open, form, isSubmitting, error, onSubmit, onClose, children } = props;
  const { modal } = App.useApp();
  const formId = useId();

  function askToClose() {
    if (isSubmitting) return;
    if (!form.isFieldsTouched()) {
      onClose();
      return;
    }
    modal.confirm({
      title: "Закрити без збереження?",
      content: "Введені дані не збережуться.",
      okText: "Закрити",
      cancelText: "Залишитись",
      onOk: onClose,
    });
  }

  return (
    <Modal
      title={title}
      open={open}
      onCancel={askToClose}
      destroyOnHidden
      footer={
        <>
          <Button onClick={askToClose} disabled={isSubmitting}>
            Скасувати
          </Button>
          {/* A real submit button of the form, so Enter works in a form of several fields (§5.4) */}
          <Button type="primary" htmlType="submit" form={formId} loading={isSubmitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <FormAlert error={error} />
      {/* The check, because Enter does not go through the button that shows the loading state */}
      <Form
        id={formId}
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={(values) => {
          if (!isSubmitting) onSubmit(values);
        }}
      >
        {children}
      </Form>
    </Modal>
  );
}
