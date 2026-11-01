import { fullNameSchema, roleLabel, type CurrentUser, type PasswordChange, type ProfileUpdate } from "@gps_crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input } from "antd";
import { ApiError, apiSend } from "../../lib/api";
import { CURRENT_USER_KEY } from "../../lib/session";
import { FormAlert, Panel, showFieldErrors, zodRule } from "../../ui";
import { NewPasswordFields } from "../auth/NewPasswordFields";

const WEAK_PASSWORD = "weak_password";

// The server answers about `password` for both: a wrong current one and a weak new one
function passwordFieldOf(error: unknown): Record<string, string> {
  const isWeak = error instanceof ApiError && error.code === WEAK_PASSWORD;
  return { password: isWeak ? "newPassword" : "currentPassword" };
}

export function ProfileForm({ user }: { user: CurrentUser }) {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<ProfileUpdate>();
  const save = useMutation({
    mutationFn: (input: ProfileUpdate) => apiSend("PATCH", "/me", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: CURRENT_USER_KEY });
      void message.success("Збережено");
    },
    onError: (error) => showFieldErrors(form, error),
  });

  return (
    <Panel title="Мої дані">
      <FormAlert error={save.error} />
      <Form<ProfileUpdate>
        form={form}
        layout="vertical"
        className="form-narrow"
        initialValues={{ fullName: user.fullName }}
        onFinish={(values) => save.mutate(values)}
      >
        <Form.Item label="ПІБ" name="fullName" required rules={[zodRule(fullNameSchema)]}>
          <Input autoComplete="name" />
        </Form.Item>
        <Form.Item label="Email">
          <Input value={user.email} disabled />
        </Form.Item>
        <Form.Item label="Роль">
          <Input value={roleLabel(user.roleKey)} disabled />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Зберегти
        </Button>
      </Form>
    </Panel>
  );
}

export function PasswordForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm<PasswordChange>();
  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: PasswordChange) =>
      apiSend("POST", "/me/password", { currentPassword, newPassword }),
    onSuccess: () => {
      form.resetFields();
      void message.success("Пароль змінено. Сесії на інших пристроях завершено.");
    },
    onError: (error) => showFieldErrors(form, error, passwordFieldOf(error)),
  });

  return (
    <Panel title="Пароль">
      <FormAlert error={change.error} />
      <Form<PasswordChange>
        form={form}
        layout="vertical"
        className="form-narrow"
        onFinish={(values) => change.mutate(values)}
      >
        <Form.Item
          label="Поточний пароль"
          name="currentPassword"
          required
          rules={[{ required: true, message: "Введіть поточний пароль" }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <NewPasswordFields name="newPassword" />
        <Button type="primary" htmlType="submit" loading={change.isPending}>
          Змінити пароль
        </Button>
      </Form>
    </Panel>
  );
}
