import { sessionListSchema, type SessionView } from "@gps_crm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { useMemo, useState } from "react";
import { apiGet, apiSend } from "../../lib/api";
import { leaveForLogin } from "../../lib/session";
import { ConfirmAction, DataTable, DateTimeText, errorMessage, Panel, type DataTableColumn } from "../../ui";
import { describeDevice } from "./device";

const SESSIONS_KEY = ["me", "sessions"];

function buildColumns(onEnd: (id: string) => void, endingId: string | undefined): DataTableColumn<SessionView>[] {
  return [
    {
      title: "Пристрій",
      key: "device",
      render: (_, session) => `${describeDevice(session.userAgent)}${session.isCurrent ? " (цей пристрій)" : ""}`,
    },
    { title: "IP", dataIndex: "ip", render: (value: string | null) => value ?? "-" },
    { title: "Остання дія", dataIndex: "lastSeenAt", render: (value: string) => <DateTimeText value={value} /> },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, session) =>
        !session.isCurrent && (
          <Button size="small" loading={endingId === session.id} onClick={() => onEnd(session.id)}>
            Завершити
          </Button>
        ),
    },
  ];
}

export function SessionsPanel() {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [isConfirming, setConfirming] = useState(false);
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: ({ signal }) => apiGet("/me/sessions", sessionListSchema, signal),
  });
  const endOne = useMutation({
    mutationFn: (id: string) => apiSend("DELETE", `/me/sessions/${id}`),
    onSuccess: () => void message.success("Сесію завершено"),
    onError: (error) => void message.error(errorMessage(error)),
    // After a failure too: a 404 means the session is already gone from another device
    onSettled: () => client.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
  const endAll = useMutation({
    mutationFn: () => apiSend("DELETE", "/me/sessions"),
    onSuccess: leaveForLogin,
    onError: (error) => void message.error(errorMessage(error)),
  });
  const endingId = endOne.isPending ? endOne.variables : undefined;
  const { mutate: endSession } = endOne;
  const columns = useMemo(() => buildColumns(endSession, endingId), [endSession, endingId]);

  return (
    <Panel title="Активні сесії">
      <DataTable
        rows={sessions.data?.items}
        columns={columns}
        rowKey="id"
        error={sessions.error}
        empty="Активних сесій немає"
        onRetry={() => void sessions.refetch()}
      />
      <div className="table-footer">
        <Button onClick={() => setConfirming(true)}>Вийти всюди</Button>
      </div>
      <ConfirmAction
        title="Вийти всюди?"
        consequence="Завершаться всі сесії, зокрема на цьому пристрої. Доведеться увійти знову."
        actionLabel="Вийти всюди"
        open={isConfirming}
        isPending={endAll.isPending}
        onConfirm={() => endAll.mutate()}
        onClose={() => setConfirming(false)}
      />
    </Panel>
  );
}
