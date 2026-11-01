import { emailSchema, type PasswordResetRequest } from "@gps_crm/shared";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";
import { Link } from "react-router";
import { apiSend } from "../../lib/api";
import { FormAlert, zodRule } from "../../ui";
import { AuthTitle } from "./AuthTitle";

export function ForgotPasswordPage() {
  const request = useMutation({
    mutationFn: (input: PasswordResetRequest) => apiSend("POST", "/auth/password-reset", input),
  });

  return (
    <>
      <AuthTitle title="Відновлення пароля" hint="Надішлю посилання для нового пароля на вашу пошту." />
      {request.isSuccess ? (
        <Alert
          type="success"
          showIcon
          title="Якщо такий email є в системі, лист уже надіслано. Посилання діє 1 годину."
        />
      ) : (
        <>
          <FormAlert error={request.error} />
          <Form<PasswordResetRequest> layout="vertical" onFinish={(values) => request.mutate(values)}>
            <Form.Item label="Email" name="email" required rules={[zodRule(emailSchema)]}>
              <Input type="email" autoComplete="username" autoFocus />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={request.isPending}>
              Надіслати посилання
            </Button>
          </Form>
        </>
      )}
      <div className="auth-links">
        <Link to="/login">Повернутися до входу</Link>
      </div>
    </>
  );
}
