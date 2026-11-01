import type { JobListItem } from "@gps_crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Button } from "antd";
import { useMemo, useState } from "react";
import { ConfirmAction, DataTable, DateTimeText, errorMessage, Panel, type DataTableColumn } from "../../ui";
import { JobHistory } from "./JobHistory";
import { requestJobRun, SYSTEM_KEY } from "./system.api";
import { VerdictTag } from "./VerdictTag";

function buildColumns(onRun: (name: string) => void, onShow: (name: string) => void): DataTableColumn<JobListItem>[] {
  return [
    {
      title: "Задача",
      dataIndex: "title",
      // The schedule under the name: a column of its own pushes the actions off a laptop screen
      render: (_, job) => (
        <>
          {job.title}
          <div className="list-meta">{job.scheduleLabel}</div>
        </>
      ),
    },
    { title: "Стан", key: "state", render: (_, job) => <VerdictTag verdict={job} /> },
    {
      title: "Останній успіх",
      dataIndex: "lastSuccessAt",
      render: (value: string | null) => <DateTimeText value={value} />,
    },
    {
      title: <span className="visually-hidden">Дії</span>,
      key: "actions",
      render: (_, job) => (
        <div className="table-actions">
          {job.canRunByHand && (
            <Button aria-label={`Запустити: ${job.title}`} onClick={() => onRun(job.name)}>
              Запустити
            </Button>
          )}
          <Button aria-label={`Історія: ${job.title}`} onClick={() => onShow(job.name)}>
            Історія
          </Button>
        </div>
      ),
    },
  ];
}

interface JobsPanelProps {
  jobs: JobListItem[] | undefined;
  error: unknown;
  onRetry: () => void;
}

export function JobsPanel({ jobs, error, onRetry }: JobsPanelProps) {
  const client = useQueryClient();
  const { message } = App.useApp();
  // Names, so an open history follows the list as it refreshes
  const [confirmingName, setConfirmingName] = useState<string | null>(null);
  const [showingName, setShowingName] = useState<string | null>(null);
  const columns = useMemo(() => buildColumns(setConfirmingName, setShowingName), []);
  const findJob = (name: string | null) => jobs?.find((job) => job.name === name) ?? null;

  function closeConfirmation() {
    void client.invalidateQueries({ queryKey: SYSTEM_KEY });
    setConfirmingName(null);
  }

  const run = useMutation({
    mutationFn: requestJobRun,
    onSuccess: () => {
      closeConfirmation();
      void message.success("Задачу поставлено в чергу");
    },
    onError: (failure) => {
      closeConfirmation();
      void message.error(errorMessage(failure));
    },
  });

  return (
    <Panel title="Фонові задачі">
      <DataTable rows={jobs} columns={columns} rowKey="name" error={error} empty="Задач немає" onRetry={onRetry} />
      <ConfirmAction
        title={`Запустити: ${findJob(confirmingName)?.title ?? ""}?`}
        consequence="Задача стане в чергу й почнеться за кілька секунд, поза розкладом."
        actionLabel="Запустити"
        isDanger={false}
        open={confirmingName !== null}
        isPending={run.isPending}
        onConfirm={() => confirmingName && run.mutate(confirmingName)}
        onClose={() => setConfirmingName(null)}
      />
      <JobHistory job={findJob(showingName)} onClose={() => setShowingName(null)} />
    </Panel>
  );
}
