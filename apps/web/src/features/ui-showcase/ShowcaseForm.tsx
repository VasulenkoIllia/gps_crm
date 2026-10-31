import { App, Button, DatePicker, Form, Input } from "antd";
import { useState } from "react";

const DATE_FORMAT = "DD.MM.YYYY";
const SIMULATED_REQUEST_MS = 600;

interface ShowcaseValues {
  name: string;
  email?: string;
  connectedAt?: unknown;
  note?: string;
}

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

export function ShowcaseForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm<ShowcaseValues>();
  const [isSaving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    await wait(SIMULATED_REQUEST_MS);
    setSaving(false);
    form.resetFields();
    void message.success("Збережено");
  }

  return (
    <Form form={form} layout="vertical" className="showcase-form" onFinish={() => void save()}>
      <Form.Item label="Назва" name="name" rules={[{ required: true, message: "Введіть назву" }]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item label="Email" name="email" rules={[{ type: "email", message: "Введіть коректний email" }]}>
        <Input autoComplete="off" />
      </Form.Item>
      <Form.Item label="Дата підключення" name="connectedAt">
        <DatePicker format={DATE_FORMAT} style={{ width: "100%" }} />
      </Form.Item>
      <Form.Item label="Примітка" name="note">
        <Input.TextArea rows={3} />
      </Form.Item>
      <div className="showcase-actions">
        <Button type="primary" htmlType="submit" loading={isSaving}>
          Зберегти
        </Button>
        <Button onClick={() => form.resetFields()} disabled={isSaving}>
          Скасувати
        </Button>
      </div>
    </Form>
  );
}
