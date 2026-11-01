import { App, Button, Form, Modal, type FormInstance } from "antd";
import { useId, useRef, type ReactNode } from "react";
import { FormAlert } from "./FormAlert";

interface FormModalProps<T> {
  title: string;
  submitLabel: string;
  open: boolean;
  form: FormInstance<T>;
  isSubmitting: boolean;
  error?: unknown;
  // The second way to save, for typing a list in by hand: the form stays open for the next record (§5.4)
  addAnotherLabel?: string;
  onSubmit: (values: T, isAddingAnother: boolean) => void;
  onClose: () => void;
  children: ReactNode;
}

export function FormModal<T>(props: FormModalProps<T>) {
  const { title, submitLabel, open, form, isSubmitting, error, addAnotherLabel, onSubmit, onClose, children } = props;
  const { modal } = App.useApp();
  const formId = useId();
  const isAddingAnother = useRef(false);

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
          {addAnotherLabel && (
            <Button
              disabled={isSubmitting}
              onClick={() => {
                isAddingAnother.current = true;
                form.submit();
              }}
            >
              {addAnotherLabel}
            </Button>
          )}
          {/* A real submit button of the form, so Enter works in a form of several fields (§5.4) */}
          <Button type="primary" htmlType="submit" form={formId} loading={isSubmitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <FormAlert error={error} />
      {/* The check, because Enter goes through neither the button that shows the loading state nor the closing form */}
      <Form
        id={formId}
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={(values) => {
          if (open && !isSubmitting) onSubmit(values, isAddingAnother.current);
          isAddingAnother.current = false;
        }}
        onFinishFailed={() => {
          isAddingAnother.current = false;
        }}
      >
        {children}
      </Form>
    </Modal>
  );
}
