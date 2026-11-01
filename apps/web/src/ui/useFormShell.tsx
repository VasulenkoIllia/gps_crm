import { App, Button, type FormInstance } from "antd";
import { useId, useRef, type ReactNode } from "react";

export interface FormShellProps<T> {
  submitLabel: string;
  open: boolean;
  form: FormInstance<T>;
  isSubmitting: boolean;
  // The second way to save, for typing a list in by hand: the form stays open for the next record (§5.4)
  addAnotherLabel?: string;
  onSubmit: (values: T, isAddingAnother: boolean) => void;
  onClose: () => void;
}

// What a modal and a drawer with a form have in common, so that the two cannot drift apart: the question before losing
// typed work, the footer and the way a submit reaches onSubmit
export function useFormShell<T>(props: FormShellProps<T>) {
  const { submitLabel, open, form, isSubmitting, addAnotherLabel, onSubmit, onClose } = props;
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

  const footer: ReactNode = (
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
  );

  const formProps = {
    id: formId,
    form,
    layout: "vertical" as const,
    preserve: false,
    // A form of several screens on a phone: the refused field may be far above the button
    scrollToFirstError: true,
    // The check, because Enter goes through neither the button that shows the loading state nor the closing form
    onFinish: (values: T) => {
      if (open && !isSubmitting) onSubmit(values, isAddingAnother.current);
      isAddingAnother.current = false;
    },
    onFinishFailed: () => {
      isAddingAnother.current = false;
    },
  };

  return { askToClose, footer, formProps };
}
