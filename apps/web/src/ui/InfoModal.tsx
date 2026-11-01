import { Button, Modal } from "antd";
import type { ReactNode } from "react";

interface InfoModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function InfoModal({ title, open, onClose, children }: InfoModalProps) {
  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Button type="primary" onClick={onClose}>
          Закрити
        </Button>
      }
    >
      {children}
    </Modal>
  );
}
