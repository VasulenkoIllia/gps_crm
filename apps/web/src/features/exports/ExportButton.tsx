import { FileExcelOutlined } from "@ant-design/icons";
import { EXPORT_ENTITIES, EXPORT_FILE_HOURS, type ExportJob } from "@gps_crm/shared";
import { useMutation } from "@tanstack/react-query";
import { App, Button } from "antd";
import { useCan } from "../../lib/session";
import { errorMessage } from "../../ui";
import { exportFileUrl, requestExport, waitForExport, type ExportOrder } from "./exports.api";

const FAILED = "Не вдалося сформувати файл. Спробуйте ще раз.";
// Long enough to reach the link when the browser held the download back, a phone or a tab in the background
const READY_MESSAGE_SECONDS = 15;

// The browser saves it under the name the server gives, and a link carries the session cookie
function download(id: string): void {
  const link = document.createElement("a");
  link.href = exportFileUrl(id);
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

// search-exports.md C: the list with the filters of the screen, built in the background. The page keeps working, and
// the file comes as a download when it is ready.
function ExportControl({ request }: { request: ExportOrder }) {
  const { message } = App.useApp();
  const run = useMutation({
    mutationFn: async () => waitForExport(await requestExport(request)),
    onSuccess: (job: ExportJob) => {
      if (job.status !== "done") {
        void message.error(job.error ?? FAILED);
        return;
      }
      download(job.id);
      void message.success({
        duration: READY_MESSAGE_SECONDS,
        content: (
          <>
            {EXPORT_ENTITIES[job.entity]}: файл готовий, рядків: {job.rowCount ?? 0}. Він зберігається{" "}
            {EXPORT_FILE_HOURS} години. <a href={exportFileUrl(job.id)}>Завантажити</a>
          </>
        ),
      });
    },
    onError: (error) => void message.error(errorMessage(error)),
  });

  return (
    <Button icon={<FileExcelOutlined />} loading={run.isPending} onClick={() => run.mutate()}>
      {run.isPending ? "Готую файл" : "Excel"}
    </Button>
  );
}

export function ExportButton({ request }: { request: ExportOrder }) {
  const canExport = useCan("data.export");
  return canExport ? <ExportControl request={request} /> : null;
}
