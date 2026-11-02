import { exportJobSchema, type ExportEntity, type ExportJob } from "@gps_crm/shared";
import { API_BASE, ApiError, apiGet, apiPost } from "../../lib/api";

// A list of a few thousand rows is ready within this, and a long one does not need a faster answer
const EXPORT_POLL_MS = 1_500;
// As long as the server gives one run of the job: past it the export is failed there as well
const EXPORT_WAIT_MS = 30 * 60 * 1_000;
// A phone out of the network for a while, or a deploy: the export goes on on the server, so the asking does too
const POLL_FAILING_MAX_MS = 60_000;
const CONNECTION_LOST =
  "Немає зв'язку з сервером. Файл ще може сформуватися: спробуйте сформувати його знову за кілька хвилин.";

// The filters as the address holds them, and the sort of the screen: the server checks them as the list does
export interface ExportOrder {
  entity: ExportEntity;
  filters: Partial<Record<string, string>>;
  sort?: string;
  order?: string;
}

export function requestExport(request: ExportOrder): Promise<ExportJob> {
  return apiPost("/exports", exportJobSchema, request);
}

function fetchExport(id: string): Promise<ExportJob> {
  return apiGet(`/exports/${id}`, exportJobSchema);
}

export function exportFileUrl(id: string): string {
  return `${API_BASE}/exports/${id}/file`;
}

function isExportOpen(job: ExportJob): boolean {
  return job.status === "queued" || job.status === "running";
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Asks until the export is finished one way or the other. It goes on after the person leaves the page: the file still
// comes, and that is what they asked for.
export async function waitForExport(job: ExportJob, now = Date.now): Promise<ExportJob> {
  const deadline = now() + EXPORT_WAIT_MS;
  let current = job;
  let failingSince: number | null = null;
  while (isExportOpen(current)) {
    if (now() > deadline) throw new Error("Файл готується надто довго. Спробуйте пізніше з меншим списком.");
    await pause(EXPORT_POLL_MS);
    try {
      current = await fetchExport(current.id);
      failingSince = null;
    } catch (error) {
      // An answer about the export itself (gone, not this person's) does not change by asking again
      if (error instanceof ApiError && error.isClientError) throw error;
      failingSince ??= now();
      if (now() - failingSince > POLL_FAILING_MAX_MS) throw new Error(CONNECTION_LOST, { cause: error });
    }
  }
  return current;
}
