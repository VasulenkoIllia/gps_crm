import { newPasswordSchema, PASSWORD_MIN_LENGTH } from "@gps_crm/shared";
import { Form, Input } from "antd";
import { zodRule } from "../../ui";

interface NewPasswordFieldsProps {
  name?: string;
  label?: string;
}

// Used inside a form of its parent: invitation, reset, profile
export function NewPasswordFields({ name = "password", label = "Новий пароль" }: NewPasswordFieldsProps) {
  return (
    <>
      <Form.Item
        label={label}
        name={name}
        required
        extra={`Щонайменше ${PASSWORD_MIN_LENGTH} символів. Найкраще кілька слів, які легко запам'ятати.`}
        rules={[zodRule(newPasswordSchema)]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        label="Повторіть пароль"
        name={`${name}Repeat`}
        required
        dependencies={[name]}
        rules={[
          ({ getFieldValue }) => ({
            validator: (_, value) =>
              value === getFieldValue(name) ? Promise.resolve() : Promise.reject(new Error("Паролі не збігаються")),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
    </>
  );
}
