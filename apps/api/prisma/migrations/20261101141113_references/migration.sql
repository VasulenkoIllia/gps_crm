-- CreateEnum
CREATE TYPE "billing_model" AS ENUM ('month', 'year');

-- CreateEnum
CREATE TYPE "cost_subject_type" AS ENUM ('server', 'sim_plan', 'addon');

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitoring_servers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "program_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "monitoring_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tariffs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "program_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "billing_model" "billing_model" NOT NULL,
    "price_kop" BIGINT NOT NULL,
    "selected_at" TIMESTAMPTZ,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tariffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addons" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_prices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "addon_id" UUID NOT NULL,
    "price_kop" BIGINT NOT NULL,
    "valid_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "addon_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addon_programs" (
    "addon_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,

    CONSTRAINT "addon_programs_pkey" PRIMARY KEY ("addon_id","program_id")
);

-- CreateTable
CREATE TABLE "tracker_models" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "tracker_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_operators" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sim_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_plans" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "operator_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "sim_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disconnect_reasons" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "archive_batch_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "disconnect_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_prices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subject_type" "cost_subject_type" NOT NULL,
    "subject_id" UUID NOT NULL,
    "cost_kop" BIGINT NOT NULL,
    "valid_from" DATE NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "cost_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "programs_name_norm_key" ON "programs"("name_norm");

-- CreateIndex
CREATE INDEX "programs_sort_order_name_norm_id_idx" ON "programs"("sort_order", "name_norm", "id");

-- CreateIndex
CREATE INDEX "programs_archive_batch_id_idx" ON "programs"("archive_batch_id");

-- CreateIndex
CREATE INDEX "monitoring_servers_archive_batch_id_idx" ON "monitoring_servers"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_servers_program_id_name_norm_key" ON "monitoring_servers"("program_id", "name_norm");

-- CreateIndex
CREATE UNIQUE INDEX "monitoring_servers_id_program_id_key" ON "monitoring_servers"("id", "program_id");

-- CreateIndex
CREATE INDEX "tariffs_program_id_server_id_name_norm_billing_model_id_idx" ON "tariffs"("program_id", "server_id", "name_norm", "billing_model", "id");

-- CreateIndex
CREATE INDEX "tariffs_archive_batch_id_idx" ON "tariffs"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "tariffs_server_id_name_norm_billing_model_key" ON "tariffs"("server_id", "name_norm", "billing_model");

-- CreateIndex
CREATE UNIQUE INDEX "addons_name_norm_key" ON "addons"("name_norm");

-- CreateIndex
CREATE INDEX "addons_archive_batch_id_idx" ON "addons"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "addon_prices_addon_id_valid_from_key" ON "addon_prices"("addon_id", "valid_from");

-- CreateIndex
CREATE INDEX "addon_programs_program_id_idx" ON "addon_programs"("program_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracker_models_name_norm_key" ON "tracker_models"("name_norm");

-- CreateIndex
CREATE INDEX "tracker_models_sort_order_name_norm_id_idx" ON "tracker_models"("sort_order", "name_norm", "id");

-- CreateIndex
CREATE INDEX "tracker_models_archive_batch_id_idx" ON "tracker_models"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sim_operators_name_norm_key" ON "sim_operators"("name_norm");

-- CreateIndex
CREATE INDEX "sim_operators_sort_order_name_norm_id_idx" ON "sim_operators"("sort_order", "name_norm", "id");

-- CreateIndex
CREATE INDEX "sim_operators_archive_batch_id_idx" ON "sim_operators"("archive_batch_id");

-- CreateIndex
CREATE INDEX "sim_plans_operator_id_sort_order_name_norm_id_idx" ON "sim_plans"("operator_id", "sort_order", "name_norm", "id");

-- CreateIndex
CREATE INDEX "sim_plans_archive_batch_id_idx" ON "sim_plans"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sim_plans_operator_id_name_norm_key" ON "sim_plans"("operator_id", "name_norm");

-- CreateIndex
CREATE UNIQUE INDEX "contractors_name_norm_key" ON "contractors"("name_norm");

-- CreateIndex
CREATE INDEX "contractors_sort_order_name_norm_id_idx" ON "contractors"("sort_order", "name_norm", "id");

-- CreateIndex
CREATE INDEX "contractors_archive_batch_id_idx" ON "contractors"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "disconnect_reasons_name_norm_key" ON "disconnect_reasons"("name_norm");

-- CreateIndex
CREATE INDEX "disconnect_reasons_sort_order_name_norm_id_idx" ON "disconnect_reasons"("sort_order", "name_norm", "id");

-- CreateIndex
CREATE INDEX "disconnect_reasons_archive_batch_id_idx" ON "disconnect_reasons"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_prices_subject_type_subject_id_valid_from_key" ON "cost_prices"("subject_type", "subject_id", "valid_from");

-- AddForeignKey
ALTER TABLE "monitoring_servers" ADD CONSTRAINT "monitoring_servers_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_server_id_program_id_fkey" FOREIGN KEY ("server_id", "program_id") REFERENCES "monitoring_servers"("id", "program_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "addon_prices" ADD CONSTRAINT "addon_prices_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_programs" ADD CONSTRAINT "addon_programs_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addon_programs" ADD CONSTRAINT "addon_programs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_plans" ADD CONSTRAINT "sim_plans_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "sim_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Not in schema.prisma, registered in schema-invariants.int.test.ts: these hold whoever writes the row.
-- The upper end is MONEY_MAX_KOP: a sum goes through the API as a number, and it has to stay a safe integer there.
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_price_kop_range" CHECK ("price_kop" BETWEEN 1 AND 10000000000);
ALTER TABLE "addon_prices" ADD CONSTRAINT "addon_prices_price_kop_range" CHECK ("price_kop" BETWEEN 1 AND 10000000000);
ALTER TABLE "cost_prices" ADD CONSTRAINT "cost_prices_cost_kop_range" CHECK ("cost_kop" BETWEEN 1 AND 10000000000);

-- A record comes back only with its package of the archive, so one out of the choice without a package stays out for good
ALTER TABLE "programs" ADD CONSTRAINT "programs_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "monitoring_servers" ADD CONSTRAINT "monitoring_servers_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "addons" ADD CONSTRAINT "addons_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "tracker_models" ADD CONSTRAINT "tracker_models_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "sim_operators" ADD CONSTRAINT "sim_operators_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "sim_plans" ADD CONSTRAINT "sim_plans_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "contractors" ADD CONSTRAINT "contractors_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));
ALTER TABLE "disconnect_reasons" ADD CONSTRAINT "disconnect_reasons_inactive_in_package" CHECK ("is_active" = ("archive_batch_id" IS NULL));

-- A price history only grows (references.md П3, D57): the same guard as the journal has
REVOKE UPDATE, DELETE ON "addon_prices", "cost_prices" FROM gps_crm_app;
