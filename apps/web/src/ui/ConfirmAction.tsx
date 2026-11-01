import { Button, Modal } from "antd";

interface ConfirmActionProps {
  title: string;
  // The consequence, in one sentence
  consequence: string;
  actionLabel: string;
  open: boolean;
  isPending: boolean;
  isDanger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

// The red button lives only here: 05-ui-standard.md §5.3
export function ConfirmAction(props: ConfirmActionProps) {
  const { title, consequence, actionLabel, open, isPending, isDanger = true, onConfirm, onClose } = props;
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      closable={!isPending}
      keyboard={!isPending}
      mask={{ closable: !isPending }}
      destroyOnHidden
      footer={
        <>
          <Button onClick={onClose} disabled={isPending}>
            Скасувати
          </Button>
          <Button type="primary" danger={isDanger} loading={isPending} onClick={onConfirm}>
            {actionLabel}
          </Button>
        </>
      }
    >
      {consequence}
    </Modal>
  );
}
