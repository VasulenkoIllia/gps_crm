import { Alert } from "antd";
import { useEffect, useRef } from "react";
import { errorMessage } from "./form-rules";

interface FormAlertProps {
  error: unknown;
  // In a long form the button that caused it may be a few screens below. Not in a list: the retry stands down there
  scrollsToView?: boolean;
}

export function FormAlert({ error, scrollsToView }: FormAlertProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && scrollsToView) box.current?.scrollIntoView?.({ block: "nearest" });
  }, [error, scrollsToView]);
  if (!error) return null;
  return (
    <div ref={box}>
      <Alert className="form-alert" type="error" showIcon title={errorMessage(error)} />
    </div>
  );
}
