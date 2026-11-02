-- Step 6: the exports to Excel (search-exports.md C). The files live in "files", 24 hours, exports.cleanup removes them.
-- CreateEnum
CREATE TYPE "export_entity" AS ENUM ('subscribers', 'objects', 'devices', 'sims', 'sensors', 'contracts');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('queued', 'running', 'done', 'failed', 'expired');

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "requested_by" UUID NOT NULL,
    "entity" "export_entity" NOT NULL,
    "params" JSONB NOT NULL,
    "status" "export_status" NOT NULL DEFAULT 'queued',
    "row_count" INTEGER,
    "file_id" UUID,
    "error" TEXT,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "finished_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_file_id_key" ON "export_jobs"("file_id");

-- CreateIndex
CREATE INDEX "export_jobs_requested_by_created_at_idx" ON "export_jobs"("requested_by", "created_at" DESC);

-- CreateIndex
CREATE INDEX "export_jobs_status_expires_at_idx" ON "export_jobs"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A finished export always has its file, rows, end and end of life: the screen offers a download on «done» alone.
-- So the file goes only after the row says «expired» (ON DELETE RESTRICT above).
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_done_has_file" CHECK (
    "status" <> 'done'
    OR ("file_id" IS NOT NULL AND "row_count" >= 0 AND "finished_at" IS NOT NULL AND "expires_at" IS NOT NULL)
);
