import { CopyOutlined } from "@ant-design/icons";
import { App, Button } from "antd";

export function CopyButton({ value, label = "Скопіювати" }: { value: string; label?: string }) {
  const { message } = App.useApp();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      void message.success("Скопійовано");
    } catch {
      // The browser may refuse it (no permission, plain http): the text stays on the screen to select by hand
      void message.error("Не вдалося скопіювати. Виділіть текст вручну.");
    }
  }

  return (
    <Button icon={<CopyOutlined />} onClick={() => void copy()}>
      {label}
    </Button>
  );
}
