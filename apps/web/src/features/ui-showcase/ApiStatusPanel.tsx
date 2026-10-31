import { HEALTH_STATUS } from "@gps_crm/shared";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Skeleton } from "antd";
import { fetchReadiness } from "../../lib/api";

export function ApiStatusPanel() {
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["health", "ready"],
    queryFn: ({ signal }) => fetchReadiness(signal),
  });

  if (isPending) return <Skeleton active paragraph={{ rows: 1 }} />;

  const retry = (
    <Button loading={isFetching} onClick={() => void refetch()}>
      Повторити
    </Button>
  );
  if (isError) return <Alert type="error" showIcon title="Не вдалося отримати стан API" action={retry} />;
  if (data.status === HEALTH_STATUS.ok) return <Alert type="success" showIcon title="API і база даних працюють" />;
  return <Alert type="warning" showIcon title="API працює, але база даних не готова" action={retry} />;
}
