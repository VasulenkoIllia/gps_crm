import { Button, Result } from "antd";
import { errorMessage } from "./form-rules";

export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Result
      status="error"
      title="Не вдалося завантажити дані"
      subTitle={errorMessage(error)}
      extra={<Button onClick={onRetry}>Повторити</Button>}
    />
  );
}
