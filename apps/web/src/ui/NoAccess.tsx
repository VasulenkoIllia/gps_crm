import { Result } from "antd";

export function NoAccess() {
  return <Result status="403" title="Немає доступу" subTitle="Для цієї сторінки потрібен інший рівень доступу." />;
}
