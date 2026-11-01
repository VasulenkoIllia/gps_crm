import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";
import { useState } from "react";
import { ConfirmAction, errorMessage } from "../../ui";
import { refreshClients } from "./subscribers.api";

export interface PlannedAction {
  title: string;
  consequence: string;
  actionLabel: string;
  doneText: string;
  isDanger?: boolean;
  run: () => Promise<void>;
  onDone?: () => void;
}

// Archive, restore, delete and the like: one question, one request, and the same way out of a refusal. A refusal closes
// the dialog and says what stands in the way, because the record behind it may be out of date by now
export function useConfirmedAction() {
  const client = useQueryClient();
  const { message } = App.useApp();
  const [planned, setPlanned] = useState<PlannedAction | null>(null);

  const action = useMutation({
    mutationFn: (step: PlannedAction) => step.run(),
    onSuccess: (_, step) => {
      refreshClients(client);
      setPlanned(null);
      void message.success(step.doneText);
      step.onDone?.();
    },
    onError: (error) => {
      refreshClients(client);
      setPlanned(null);
      void message.error(errorMessage(error));
    },
  });

  const dialog = (
    <ConfirmAction
      title={planned?.title ?? ""}
      consequence={planned?.consequence ?? ""}
      actionLabel={planned?.actionLabel ?? ""}
      isDanger={planned?.isDanger ?? false}
      open={planned !== null}
      isPending={action.isPending}
      onConfirm={() => planned && action.mutate(planned)}
      onClose={() => setPlanned(null)}
    />
  );

  return { ask: setPlanned, dialog };
}
