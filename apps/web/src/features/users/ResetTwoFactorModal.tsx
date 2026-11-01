import type { PasswordConfirm, UserListItem } from "@gps_crm/shared";
import { useMutation } from "@tanstack/react-query";
import { Form, Input } from "antd";
import { FormModal, showFieldErrors } from "../../ui";
import { resetTwoFactor } from "./users.api";

interface ResetTwoFactorModalProps {
  user: UserListItem | null;
  onClose: () => void;
  onDone: () => void;
}

export function ResetTwoFactorModal({ user, onClose, onDone }: ResetTwoFactorModalProps) {
  const [form] = Form.useForm<PasswordConfirm>();
  const reset = useMutation({
    mutationFn: ({ password }: PasswordConfirm) => resetTwoFactor(user?.id ?? "", password),
    onSuccess: () => {
      reset.reset();
      onDone();
    },
    onError: (error) => showFieldErrors(form, error),
  });

  return (
    <FormModal
      title={`Скинути 2FA: ${user?.fullName ?? ""}`}
      submitLabel="Скинути 2FA"
      open={user !== null}
      form={form}
      isSubmitting={reset.isPending}
      error={reset.error}
      onSubmit={(values) => reset.mutate(values)}
      onClose={() => {
        reset.reset();
        onClose();
      }}
    >
      <p>Усі сесії людини завершаться, а під час наступного входу вона налаштує 2FA заново.</p>
      <Form.Item label="Ваш пароль" name="password" required rules={[{ required: true, message: "Введіть пароль" }]}>
        <Input.Password autoComplete="current-password" autoFocus />
      </Form.Item>
    </FormModal>
  );
}
