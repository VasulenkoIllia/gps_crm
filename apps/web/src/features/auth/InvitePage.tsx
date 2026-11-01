import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Form } from "antd";
import { useNavigate } from "react-router";
import { apiSend } from "../../lib/api";
import { useFragmentToken } from "../../lib/fragment-token";
import { queryClient } from "../../lib/query-client";
import { FormAlert, showFieldErrors } from "../../ui";
import { AuthTitle } from "./AuthTitle";
import { NewPasswordFields } from "./NewPasswordFields";

interface InviteValues {
  password: string;
}

export function InvitePage() {
  const token = useFragmentToken();
  const navigate = useNavigate();
  const [form] = Form.useForm<InviteValues>();
  const accept = useMutation({
    mutationFn: ({ password }: InviteValues) => apiSend("POST", "/invitations/accept", { token, password }),
    onSuccess: () => {
      queryClient.clear();
      void navigate("/setup-2fa", { replace: true });
    },
    onError: (error) => showFieldErrors(form, error),
  });

  if (!token) {
    return (
      <>
        <AuthTitle title="Запрошення" />
        <Alert type="error" showIcon title="Посилання неповне. Відкрийте його з листа ще раз." />
      </>
    );
  }

  return (
    <>
      <AuthTitle title="Вітаю в системі" hint="Створіть пароль, далі налаштуємо двофакторний вхід." />
      <FormAlert error={accept.error} />
      <Form<InviteValues> form={form} layout="vertical" onFinish={(values) => accept.mutate(values)}>
        <NewPasswordFields label="Пароль" />
        <Button type="primary" htmlType="submit" block loading={accept.isPending}>
          Створити пароль
        </Button>
      </Form>
    </>
  );
}
