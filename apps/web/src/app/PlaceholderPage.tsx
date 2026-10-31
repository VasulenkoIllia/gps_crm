import { Empty } from "antd";
import { PageHeader, Panel } from "../ui";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Panel>
        <Empty description="Цей розділ з'явиться на наступних кроках роботи" />
      </Panel>
    </>
  );
}
