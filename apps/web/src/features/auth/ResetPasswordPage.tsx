import { useMutation } from "@tanstack/react-query";
import { Alert, App, Button, Form } from "antd";
import { Link, useNavigate } from "react-router";
import { apiSend } from "../../lib/api";
import { useFragmentToken } from "../../lib/fragment-token";
import { FormAlert, showFieldErrors } from "../../ui";
import { AuthTitle } from "./AuthTitle";
import { NewPasswordFields } from "./NewPasswordFields";

interface ResetValues {
  password: string;
}

export function ResetPasswordPage() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm<ResetValues>();
  const reset = useMutation({
    mutationFn: ({ password }: ResetValues) => apiSend("POST", "/auth/password-reset/confirm", { token, password }),
    onSuccess: () => {
      void message.success("Пароль змінено. Увійдіть з новим паролем.");
      void navigate("/login", { replace: true });
    },
    onError: (error) => showFieldErrors(form, error),
  });

  if (!token) {
    return (
      <>
        <AuthTitle title="Новий пароль" />
        <Alert type="error" showIcon title="Посилання неповне. Відкрийте його з листа ще раз." />
        <div className="auth-links">
          <Link to="/forgot-password">Надіслати нове посилання</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthTitle title="Новий пароль" />
      <FormAlert error={reset.error} />
      <Form<ResetValues> form={form} layout="vertical" onFinish={(values) => reset.mutate(values)}>
        <NewPasswordFields />
        <Button type="primary" htmlType="submit" block loading={reset.isPending}>
          Зберегти пароль
        </Button>
      </Form>
      <div className="auth-links">
        <Link to="/forgot-password">Надіслати нове посилання</Link>
      </div>
    </>
  );
}
