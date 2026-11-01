import { Alert } from "antd";
import { errorMessage } from "./form-rules";

export function FormAlert({ error }: { error: unknown }) {
  if (!error) return null;
  return <Alert className="form-alert" type="error" showIcon title={errorMessage(error)} />;
}
