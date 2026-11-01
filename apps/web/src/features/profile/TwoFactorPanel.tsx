import { recoveryCodesSchema, type PasswordConfirm } from "@gps_crm/shared";
import { useMutation } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { useState } from "react";
import { apiPost } from "../../lib/api";
import { FormModal, InfoModal, Panel, showFieldErrors } from "../../ui";
import { RecoveryCodesList } from "../auth/RecoveryCodesList";

export function TwoFactorPanel() {
  const [isAsking, setAsking] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [form] = Form.useForm<PasswordConfirm>();
  const regenerate = useMutation({
    mutationFn: (input: PasswordConfirm) => apiPost("/me/2fa/recovery-codes", recoveryCodesSchema, input),
    onSuccess: ({ recoveryCodes }) => {
      setAsking(false);
      setCodes(recoveryCodes);
    },
    onError: (error) => showFieldErrors(form, error),
  });

  return (
    <Panel title="Двофакторний вхід">
      <p>Увімкнено. Для входу потрібен код із застосунку на телефоні.</p>
      <Button onClick={() => setAsking(true)}>Створити нові коди відновлення</Button>
      <FormModal
        title="Нові коди відновлення"
        submitLabel="Створити коди"
        open={isAsking}
        form={form}
        isSubmitting={regenerate.isPending}
        error={regenerate.error}
        onSubmit={(values) => regenerate.mutate(values)}
        onClose={() => {
          regenerate.reset();
          setAsking(false);
        }}
      >
        <p>Старі коди перестануть діяти.</p>
        <Form.Item label="Ваш пароль" name="password" required rules={[{ required: true, message: "Введіть пароль" }]}>
          <Input.Password autoComplete="current-password" autoFocus />
        </Form.Item>
      </FormModal>
      <InfoModal title="Коди відновлення" open={codes !== null} onClose={() => setCodes(null)}>
        <p>Збережіть їх у надійному місці. Більше я їх не покажу.</p>
        <RecoveryCodesList codes={codes ?? []} />
      </InfoModal>
    </Panel>
  );
}
