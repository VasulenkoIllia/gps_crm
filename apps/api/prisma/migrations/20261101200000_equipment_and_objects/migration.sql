-- CreateEnum
CREATE TYPE "object_status" AS ENUM ('active', 'suspended', 'disconnected');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('installed', 'removed', 'repair', 'written_off');

-- CreateEnum
CREATE TYPE "device_ownership" AS ENUM ('sold', 'rented');

-- CreateEnum
CREATE TYPE "sim_status" AS ENUM ('active', 'blocked', 'free');

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "imei" TEXT NOT NULL,
    "imei_rev" TEXT NOT NULL,
    "model_id" UUID,
    "status" "device_status" NOT NULL DEFAULT 'removed',
    "ownership" "device_ownership",
    "current_sim_id" UUID,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sims" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "iccid" TEXT NOT NULL,
    "iccid_rev" TEXT NOT NULL,
    "msisdn" TEXT,
    "msisdn_rev" TEXT,
    "operator_id" UUID,
    "plan_id" UUID,
    "status" "sim_status" NOT NULL DEFAULT 'free',
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "sims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensors" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "serial_no" TEXT NOT NULL,
    "serial_no_norm" TEXT NOT NULL,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "sensors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objects" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subscriber_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "status" "object_status" NOT NULL,
    "status_from" DATE NOT NULL,
    "connected_on" DATE NOT NULL,
    "disconnected_on" DATE,
    "disconnect_reason_id" UUID,
    "payer_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "server_id" UUID NOT NULL,
    "has_own_tariff" BOOLEAN NOT NULL DEFAULT false,
    "current_device_id" UUID,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_status_periods" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "object_id" UUID NOT NULL,
    "status" "object_status" NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "reason_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "object_status_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_service_terms" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "object_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "own_tariff_id" UUID,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "object_service_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_addon_periods" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "object_id" UUID NOT NULL,
    "addon_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "object_addon_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_installations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "object_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "contractor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "device_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_installations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "device_id" UUID NOT NULL,
    "sim_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "contractor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "sim_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensor_installations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "object_id" UUID NOT NULL,
    "sensor_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "contractor_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "sensor_installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_imei_key" ON "devices"("imei");

-- CreateIndex
CREATE UNIQUE INDEX "devices_current_sim_id_key" ON "devices"("current_sim_id");

-- CreateIndex
CREATE INDEX "devices_model_id_idx" ON "devices"("model_id");

-- CreateIndex
CREATE INDEX "devices_archive_batch_id_idx" ON "devices"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sims_iccid_key" ON "sims"("iccid");

-- CreateIndex
CREATE UNIQUE INDEX "sims_msisdn_key" ON "sims"("msisdn");

-- CreateIndex
CREATE INDEX "sims_operator_id_idx" ON "sims"("operator_id");

-- CreateIndex
CREATE INDEX "sims_plan_id_idx" ON "sims"("plan_id");

-- CreateIndex
CREATE INDEX "sims_archive_batch_id_idx" ON "sims"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "sensors_serial_no_key" ON "sensors"("serial_no");

-- CreateIndex
CREATE INDEX "sensors_archive_batch_id_idx" ON "sensors"("archive_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "objects_current_device_id_key" ON "objects"("current_device_id");

-- CreateIndex
CREATE INDEX "objects_subscriber_id_idx" ON "objects"("subscriber_id");

-- CreateIndex
CREATE INDEX "objects_payer_id_idx" ON "objects"("payer_id");

-- CreateIndex
CREATE INDEX "objects_tariff_id_idx" ON "objects"("tariff_id");

-- CreateIndex
CREATE INDEX "objects_program_id_idx" ON "objects"("program_id");

-- CreateIndex
CREATE INDEX "objects_server_id_idx" ON "objects"("server_id");

-- CreateIndex
CREATE INDEX "objects_disconnect_reason_id_idx" ON "objects"("disconnect_reason_id");

-- CreateIndex
CREATE INDEX "objects_archive_batch_id_idx" ON "objects"("archive_batch_id");

-- CreateIndex
CREATE INDEX "object_status_periods_object_id_valid_from_id_idx" ON "object_status_periods"("object_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "object_status_periods_reason_id_idx" ON "object_status_periods"("reason_id");

-- CreateIndex
CREATE INDEX "object_service_terms_object_id_valid_from_id_idx" ON "object_service_terms"("object_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "object_service_terms_payer_id_idx" ON "object_service_terms"("payer_id");

-- CreateIndex
CREATE INDEX "object_service_terms_own_tariff_id_idx" ON "object_service_terms"("own_tariff_id");

-- CreateIndex
CREATE INDEX "object_addon_periods_object_id_valid_from_id_idx" ON "object_addon_periods"("object_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "object_addon_periods_addon_id_idx" ON "object_addon_periods"("addon_id");

-- CreateIndex
CREATE INDEX "device_installations_object_id_valid_from_id_idx" ON "device_installations"("object_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "device_installations_device_id_valid_from_id_idx" ON "device_installations"("device_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "device_installations_contractor_id_idx" ON "device_installations"("contractor_id");

-- CreateIndex
CREATE INDEX "sim_installations_device_id_valid_from_id_idx" ON "sim_installations"("device_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sim_installations_sim_id_valid_from_id_idx" ON "sim_installations"("sim_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sim_installations_contractor_id_idx" ON "sim_installations"("contractor_id");

-- CreateIndex
CREATE INDEX "sensor_installations_object_id_valid_from_id_idx" ON "sensor_installations"("object_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sensor_installations_sensor_id_valid_from_id_idx" ON "sensor_installations"("sensor_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sensor_installations_contractor_id_idx" ON "sensor_installations"("contractor_id");

-- CreateIndex
CREATE UNIQUE INDEX "sim_plans_id_operator_id_key" ON "sim_plans"("id", "operator_id");

-- CreateIndex
CREATE UNIQUE INDEX "tariffs_id_server_id_program_id_key" ON "tariffs"("id", "server_id", "program_id");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "tracker_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_current_sim_id_fkey" FOREIGN KEY ("current_sim_id") REFERENCES "sims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sims" ADD CONSTRAINT "sims_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "sim_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sims" ADD CONSTRAINT "sims_plan_id_operator_id_fkey" FOREIGN KEY ("plan_id", "operator_id") REFERENCES "sim_plans"("id", "operator_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_disconnect_reason_id_fkey" FOREIGN KEY ("disconnect_reason_id") REFERENCES "disconnect_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "monitoring_servers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_tariff_id_server_id_program_id_fkey" FOREIGN KEY ("tariff_id", "server_id", "program_id") REFERENCES "tariffs"("id", "server_id", "program_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "objects" ADD CONSTRAINT "objects_current_device_id_fkey" FOREIGN KEY ("current_device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_status_periods" ADD CONSTRAINT "object_status_periods_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_status_periods" ADD CONSTRAINT "object_status_periods_reason_id_fkey" FOREIGN KEY ("reason_id") REFERENCES "disconnect_reasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_service_terms" ADD CONSTRAINT "object_service_terms_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_service_terms" ADD CONSTRAINT "object_service_terms_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_service_terms" ADD CONSTRAINT "object_service_terms_own_tariff_id_fkey" FOREIGN KEY ("own_tariff_id") REFERENCES "tariffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_addon_periods" ADD CONSTRAINT "object_addon_periods_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_addon_periods" ADD CONSTRAINT "object_addon_periods_addon_id_fkey" FOREIGN KEY ("addon_id") REFERENCES "addons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_installations" ADD CONSTRAINT "sim_installations_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_installations" ADD CONSTRAINT "sim_installations_sim_id_fkey" FOREIGN KEY ("sim_id") REFERENCES "sims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sim_installations" ADD CONSTRAINT "sim_installations_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installations" ADD CONSTRAINT "sensor_installations_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installations" ADD CONSTRAINT "sensor_installations_sensor_id_fkey" FOREIGN KEY ("sensor_id") REFERENCES "sensors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sensor_installations" ADD CONSTRAINT "sensor_installations_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- Objects outside the Prisma schema. Registered in src/core/db/schema-invariants.int.test.ts.

-- The numbers as packages/shared leaves them: whoever writes the row, a typo in a script stops here
ALTER TABLE "devices" ADD CONSTRAINT "devices_imei_format" CHECK ("imei" ~ '^\d{15}$');
ALTER TABLE "sims" ADD CONSTRAINT "sims_iccid_format" CHECK ("iccid" ~ '^\d{19,20}$');
ALTER TABLE "sims" ADD CONSTRAINT "sims_msisdn_format" CHECK ("msisdn" ~ '^\+380\d{9}$');
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_serial_no_length" CHECK (char_length("serial_no") BETWEEN 1 AND 100);
ALTER TABLE "objects" ADD CONSTRAINT "objects_name_length" CHECK (char_length("name") BETWEEN 1 AND 300);

-- What holds whichever way a row was written (objects.md П8, 10-fields.md 3.1, 3.11)
ALTER TABLE "objects" ADD CONSTRAINT "objects_disconnected_on_with_status" CHECK (("status" = 'disconnected') = ("disconnected_on" IS NOT NULL));
ALTER TABLE "objects" ADD CONSTRAINT "objects_reason_only_when_disconnected" CHECK ("disconnect_reason_id" IS NULL OR "status" = 'disconnected');
ALTER TABLE "objects" ADD CONSTRAINT "objects_working_with_tracker" CHECK ("status" = 'disconnected' OR "current_device_id" IS NOT NULL);
-- A plan belongs to an operator, and a foreign key with an empty column is not checked at all
ALTER TABLE "sims" ADD CONSTRAINT "sims_plan_with_operator" CHECK ("plan_id" IS NULL OR "operator_id" IS NOT NULL);

-- A record comes back only with its package of the archive, as on the clients
ALTER TABLE "devices" ADD CONSTRAINT "devices_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));
ALTER TABLE "sims" ADD CONSTRAINT "sims_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));
ALTER TABLE "sensors" ADD CONSTRAINT "sensors_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));
ALTER TABLE "objects" ADD CONSTRAINT "objects_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));

-- [valid_from, valid_to): the histories of 03-data-model.md §3.4. An empty period overlaps nothing, which is how a version
-- dropped before it began, or a status changed twice in one day, stays on record.
ALTER TABLE "object_status_periods" ADD CONSTRAINT "object_status_periods_dates" CHECK ("valid_to" >= "valid_from");
ALTER TABLE "object_status_periods" ADD CONSTRAINT "object_status_periods_no_overlap"
  EXCLUDE USING gist ("object_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
ALTER TABLE "object_service_terms" ADD CONSTRAINT "object_service_terms_dates" CHECK ("valid_to" >= "valid_from");
ALTER TABLE "object_service_terms" ADD CONSTRAINT "object_service_terms_no_overlap"
  EXCLUDE USING gist ("object_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
ALTER TABLE "object_addon_periods" ADD CONSTRAINT "object_addon_periods_dates" CHECK ("valid_to" >= "valid_from");
ALTER TABLE "object_addon_periods" ADD CONSTRAINT "object_addon_periods_no_overlap"
  EXCLUDE USING gist ("object_id" WITH =, "addon_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
-- Both ways: one tracker on an object at a time, and an object for a tracker
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_dates" CHECK ("valid_to" >= "valid_from");
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_object_no_overlap"
  EXCLUDE USING gist ("object_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
ALTER TABLE "device_installations" ADD CONSTRAINT "device_installations_device_no_overlap"
  EXCLUDE USING gist ("device_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
ALTER TABLE "sim_installations" ADD CONSTRAINT "sim_installations_dates" CHECK ("valid_to" >= "valid_from");
ALTER TABLE "sim_installations" ADD CONSTRAINT "sim_installations_device_no_overlap"
  EXCLUDE USING gist ("device_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
ALTER TABLE "sim_installations" ADD CONSTRAINT "sim_installations_sim_no_overlap"
  EXCLUDE USING gist ("sim_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);
-- Several sensors on one object, so only the side of the sensor
ALTER TABLE "sensor_installations" ADD CONSTRAINT "sensor_installations_dates" CHECK ("valid_to" >= "valid_from");
ALTER TABLE "sensor_installations" ADD CONSTRAINT "sensor_installations_sensor_no_overlap"
  EXCLUDE USING gist ("sensor_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);

-- text_pattern_ops: only these serve LIKE 'prefix%' under a language collation. *_rev finds a number by how it ends.
CREATE INDEX "devices_imei_pattern_idx" ON "devices"("imei" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "devices_imei_rev_idx" ON "devices"("imei_rev" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "sims_iccid_pattern_idx" ON "sims"("iccid" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "sims_iccid_rev_idx" ON "sims"("iccid_rev" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "sims_msisdn_rev_idx" ON "sims"("msisdn_rev" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "sensors_serial_no_norm_trgm_idx" ON "sensors" USING gin ("serial_no_norm" gin_trgm_ops) WHERE "archived_at" IS NULL;

-- The lists go by id, newest first, and the choice in a form asks for one status
CREATE INDEX "devices_status_id_idx" ON "devices"("status", "id" DESC) WHERE "archived_at" IS NULL;
CREATE INDEX "sims_status_id_idx" ON "sims"("status", "id" DESC) WHERE "archived_at" IS NULL;
-- What is on an object right now: the empty end finds it without walking the history
CREATE INDEX "device_installations_open_idx" ON "device_installations"("device_id") WHERE "valid_to" IS NULL;
CREATE INDEX "sim_installations_open_idx" ON "sim_installations"("sim_id") WHERE "valid_to" IS NULL;
CREATE INDEX "sensor_installations_open_idx" ON "sensor_installations"("sensor_id") WHERE "valid_to" IS NULL;
CREATE INDEX "object_addon_periods_open_idx" ON "object_addon_periods"("addon_id", "object_id") WHERE "valid_to" IS NULL;

-- Every sort of the live list has an index with the same predicate (06-quality.md): a page reads as many rows as it
-- shows. The archive is opened rarely and scans
CREATE INDEX "objects_name_norm_id_idx" ON "objects"("name_norm", "id") WHERE "archived_at" IS NULL;
CREATE INDEX "objects_connected_on_id_idx" ON "objects"("connected_on", "id") WHERE "archived_at" IS NULL;
CREATE INDEX "objects_subscriber_id_id_idx" ON "objects"("subscriber_id", "id") WHERE "archived_at" IS NULL;
CREATE INDEX "objects_subscriber_id_name_norm_id_idx" ON "objects"("subscriber_id", "name_norm", "id") WHERE "archived_at" IS NULL;
CREATE INDEX "objects_status_program_id_idx" ON "objects"("status", "program_id") WHERE "archived_at" IS NULL;
-- The objects of a payer in force: payers.md П6, П11 and the count on the card of a payer
CREATE INDEX "objects_payer_id_status_idx" ON "objects"("payer_id", "status") WHERE "archived_at" IS NULL;
-- The archive is the small part of the table, and the working indexes above do not see it
CREATE INDEX "objects_archived_name_norm_id_idx" ON "objects"("name_norm", "id") WHERE "archived_at" IS NOT NULL;
CREATE INDEX "objects_name_norm_trgm_idx" ON "objects" USING gin ("name_norm" gin_trgm_ops) WHERE "archived_at" IS NULL;
