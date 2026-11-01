import { Input, type InputProps } from "antd";

// Text, not a number field: a sum stays whole kopecks on its way to the API (packages/shared/src/money.ts)
export function MoneyInput(props: InputProps) {
  return <Input inputMode="decimal" autoComplete="off" suffix="грн" {...props} />;
}
