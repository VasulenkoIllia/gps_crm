import {
  emailSchema,
  fullNameSchema,
  ROLE_KEYS,
  roleLabel,
  type InvitationInput,
  type LinkDelivery,
} from "@gps_crm/shared";
import { useMutation } from "@tanstack/react-query";
import { Form, Input, Radio } from "antd";
import { FormModal, showFieldErrors, zodRule } from "../../ui";
import { inviteUser } from "./users.api";

interface InviteUserModalProps {
  open: boolean;
  onClose: () => void;
  onInvited: (delivery: LinkDelivery) => void;
}

const ROLE_OPTIONS = ROLE_KEYS.map((key) => ({ value: key, label: roleLabel(key) }));

export function InviteUserModal({ open, onClose, onInvited }: InviteUserModalProps) {
  const [form] = Form.useForm<InvitationInput>();
  const invite = useMutation({
    mutationFn: inviteUser,
    onSuccess: onInvited,
    onError: (error) => showFieldErrors(form, error),
  });

  return (
    <FormModal
      title="Запросити користувача"
      submitLabel="Запросити"
      open={open}
      form={form}
      isSubmitting={invite.isPending}
      error={invite.error}
      onSubmit={(values) => invite.mutate(values)}
      onClose={() => {
        invite.reset();
        onClose();
      }}
    >
      <Form.Item label="ПІБ" name="fullName" required rules={[zodRule(fullNameSchema)]}>
        <Input autoComplete="off" autoFocus />
      </Form.Item>
      <Form.Item label="Email" name="email" required rules={[zodRule(emailSchema)]}>
        <Input type="email" autoComplete="off" />
      </Form.Item>
      <Form.Item label="Роль" name="roleKey" required rules={[{ required: true, message: "Виберіть роль" }]}>
        <Radio.Group options={ROLE_OPTIONS} />
      </Form.Item>
    </FormModal>
  );
}
