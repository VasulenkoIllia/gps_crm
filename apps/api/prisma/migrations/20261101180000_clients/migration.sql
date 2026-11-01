-- CreateEnum
CREATE TYPE "subscriber_type" AS ENUM ('B2C', 'B2B', 'B2G');

-- CreateEnum
CREATE TYPE "subscriber_status" AS ENUM ('active', 'partially_suspended', 'suspended', 'disconnected');

-- CreateEnum
CREATE TYPE "contact_channel" AS ENUM ('telegram', 'viber', 'email');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('invoice', 'vchasno', 'iban');

-- AlterTable
ALTER TABLE "archive_batches" ADD COLUMN     "subscriber_id" UUID;

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "storage" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_id_series" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "range_from" BIGINT NOT NULL,
    "range_to" BIGINT NOT NULL,
    "next_number" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "subscriber_id_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_id_series_types" (
    "type" "subscriber_type" NOT NULL,
    "series_id" UUID NOT NULL,

    CONSTRAINT "subscriber_id_series_types_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "code" BIGINT NOT NULL,
    "legacy_code" TEXT,
    "type" "subscriber_type" NOT NULL,
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "tax_id" TEXT,
    "crm_url" TEXT,
    "manager_id" UUID NOT NULL,
    "grace_days" INTEGER NOT NULL DEFAULT 0,
    "discount_kop" BIGINT NOT NULL DEFAULT 0,
    "program_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "status" "subscriber_status" NOT NULL DEFAULT 'disconnected',
    "objects_active" INTEGER NOT NULL DEFAULT 0,
    "objects_suspended" INTEGER NOT NULL DEFAULT 0,
    "objects_disconnected" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriber_tariff_periods" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subscriber_id" UUID NOT NULL,
    "tariff_id" UUID NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "subscriber_tariff_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subscriber_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "full_name_norm" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT NOT NULL,
    "phone_rev" TEXT NOT NULL,
    "phone2" TEXT,
    "phone2_rev" TEXT,
    "email" TEXT,
    "telegram_chat_id" TEXT,
    "viber_chat_id" TEXT,
    "channel" "contact_channel",
    "crm_url" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "billing_notify" BOOLEAN NOT NULL DEFAULT true,
    "tech_notify" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payers" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "name_norm" TEXT NOT NULL,
    "payment_method" "payment_method" NOT NULL,
    "legal_name" TEXT,
    "tax_id" TEXT,
    "vchasno_email" TEXT,
    "details_contact" TEXT,
    "payment_terms_note" TEXT,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payer_subscribers" (
    "payer_id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "payer_subscribers_pkey" PRIMARY KEY ("payer_id","subscriber_id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "subscriber_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "number_norm" TEXT NOT NULL,
    "signed_on" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "terminated_on" DATE,
    "note" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,
    "archived_at" TIMESTAMPTZ,
    "archived_by" UUID,
    "archive_batch_id" UUID,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_key_key" ON "files"("key");

-- CreateIndex
CREATE INDEX "files_owner_type_owner_id_id_idx" ON "files"("owner_type", "owner_id", "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscriber_id_series_name_norm_key" ON "subscriber_id_series"("name_norm");

-- CreateIndex
CREATE INDEX "subscriber_id_series_types_series_id_idx" ON "subscriber_id_series_types"("series_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_code_key" ON "subscribers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_legacy_code_key" ON "subscribers"("legacy_code");

-- CreateIndex
CREATE INDEX "subscribers_tariff_id_idx" ON "subscribers"("tariff_id");

-- CreateIndex
CREATE INDEX "subscribers_manager_id_idx" ON "subscribers"("manager_id");

-- CreateIndex
CREATE INDEX "subscribers_program_id_idx" ON "subscribers"("program_id");

-- CreateIndex
CREATE INDEX "subscribers_archive_batch_id_idx" ON "subscribers"("archive_batch_id");

-- CreateIndex
CREATE INDEX "subscriber_tariff_periods_subscriber_id_valid_from_id_idx" ON "subscriber_tariff_periods"("subscriber_id", "valid_from" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "subscriber_tariff_periods_tariff_id_idx" ON "subscriber_tariff_periods"("tariff_id");

-- CreateIndex
CREATE INDEX "contacts_subscriber_id_idx" ON "contacts"("subscriber_id");

-- CreateIndex
CREATE INDEX "contacts_archive_batch_id_idx" ON "contacts"("archive_batch_id");

-- CreateIndex
CREATE INDEX "payers_archive_batch_id_idx" ON "payers"("archive_batch_id");

-- CreateIndex
CREATE INDEX "payer_subscribers_subscriber_id_idx" ON "payer_subscribers"("subscriber_id");

-- CreateIndex
CREATE INDEX "contracts_subscriber_id_idx" ON "contracts"("subscriber_id");

-- CreateIndex
CREATE INDEX "contracts_payer_id_idx" ON "contracts"("payer_id");

-- CreateIndex
CREATE INDEX "contracts_archive_batch_id_idx" ON "contracts"("archive_batch_id");

-- CreateIndex
CREATE INDEX "archive_batches_subscriber_id_idx" ON "archive_batches"("subscriber_id");

-- CreateIndex
CREATE UNIQUE INDEX "tariffs_id_program_id_key" ON "tariffs"("id", "program_id");

-- AddForeignKey
ALTER TABLE "archive_batches" ADD CONSTRAINT "archive_batches_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_id_series_types" ADD CONSTRAINT "subscriber_id_series_types_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "subscriber_id_series"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_tariff_id_program_id_fkey" FOREIGN KEY ("tariff_id", "program_id") REFERENCES "tariffs"("id", "program_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "subscriber_tariff_periods" ADD CONSTRAINT "subscriber_tariff_periods_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriber_tariff_periods" ADD CONSTRAINT "subscriber_tariff_periods_tariff_id_fkey" FOREIGN KEY ("tariff_id") REFERENCES "tariffs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_subscribers" ADD CONSTRAINT "payer_subscribers_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payer_subscribers" ADD CONSTRAINT "payer_subscribers_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_payer_id_subscriber_id_fkey" FOREIGN KEY ("payer_id", "subscriber_id") REFERENCES "payer_subscribers"("payer_id", "subscriber_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Objects outside the Prisma schema. Registered in src/core/db/schema-invariants.int.test.ts.

-- Series of ID (03-data-model.md §3.2): whoever writes the row, ranges do not overlap and the next number stays inside.
-- One past the end is a series used up.
ALTER TABLE "subscriber_id_series" ADD CONSTRAINT "subscriber_id_series_range" CHECK ("range_from" >= 10000 AND "range_from" <= "range_to");
ALTER TABLE "subscriber_id_series" ADD CONSTRAINT "subscriber_id_series_next_number" CHECK ("next_number" BETWEEN "range_from" AND "range_to" + 1);
ALTER TABLE "subscriber_id_series" ADD CONSTRAINT "subscriber_id_series_no_overlap" EXCLUDE USING gist (int8range("range_from", "range_to", '[]') WITH &&);

-- The starting series (D35), so that a client can be created on the day this lands. The client changes them on the screen.
WITH individuals AS (
  INSERT INTO "subscriber_id_series" ("name", "name_norm", "range_from", "range_to", "next_number")
  VALUES ('Фізособи', 'фізособи', 10000, 49999, 10000)
  RETURNING "id"
), companies AS (
  INSERT INTO "subscriber_id_series" ("name", "name_norm", "range_from", "range_to", "next_number")
  VALUES ('Юрособи', 'юрособи', 50000, 99999, 50000)
  RETURNING "id"
)
INSERT INTO "subscriber_id_series_types" ("type", "series_id")
SELECT 'B2C'::"subscriber_type", "id" FROM individuals
UNION ALL SELECT 'B2B'::"subscriber_type", "id" FROM companies
UNION ALL SELECT 'B2G'::"subscriber_type", "id" FROM companies;

ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_code_min" CHECK ("code" >= 10000);
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_name_length" CHECK (char_length("name") BETWEEN 1 AND 300);
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_tax_id_format" CHECK ("tax_id" ~ '^(\d{8}|\d{10})$');
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_tax_id_required" CHECK ("type" = 'B2C' OR "tax_id" IS NOT NULL);
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_crm_url_format" CHECK ("crm_url" ~ '^https?://');
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_grace_days_range" CHECK ("grace_days" >= 0);
-- The upper end is MONEY_MAX_KOP, as on the prices of the reference lists
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_discount_kop_range" CHECK ("discount_kop" BETWEEN 0 AND 10000000000);
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_object_counts" CHECK ("objects_active" >= 0 AND "objects_suspended" >= 0 AND "objects_disconnected" >= 0);

-- A record comes back only with its package of the archive, so one archived without a package stays out for good
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));
ALTER TABLE "payers" ADD CONSTRAINT "payers_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_archived_in_package" CHECK (("archived_at" IS NULL) = ("archive_batch_id" IS NULL));

-- Every sort of the list has an index with the same predicate (06-quality.md): a page reads as many rows as it shows
CREATE INDEX "subscribers_name_norm_id_idx" ON "subscribers"("name_norm", "id") WHERE "archived_at" IS NULL;
CREATE INDEX "subscribers_objects_active_id_idx" ON "subscribers"("objects_active", "id") WHERE "archived_at" IS NULL;
CREATE INDEX "subscribers_manager_id_name_norm_id_idx" ON "subscribers"("manager_id", "name_norm", "id") WHERE "archived_at" IS NULL;
-- The count of clients on the screen of tariffs stays in the index
CREATE INDEX "subscribers_tariff_id_live_idx" ON "subscribers"("tariff_id") WHERE "archived_at" IS NULL;
CREATE INDEX "subscribers_status_type_idx" ON "subscribers"("status", "type") WHERE "archived_at" IS NULL;
-- The archive is the small part of the table, and the working indexes above do not see it
CREATE INDEX "subscribers_archived_name_norm_id_idx" ON "subscribers"("name_norm", "id") WHERE "archived_at" IS NOT NULL;
CREATE INDEX "subscribers_name_norm_trgm_idx" ON "subscribers" USING gin ("name_norm" gin_trgm_ops) WHERE "archived_at" IS NULL;
-- text_pattern_ops: only these serve LIKE 'prefix%' under a language collation
CREATE INDEX "subscribers_tax_id_idx" ON "subscribers"("tax_id" text_pattern_ops) WHERE "tax_id" IS NOT NULL;
CREATE INDEX "subscribers_crm_url_idx" ON "subscribers"("crm_url") WHERE "crm_url" IS NOT NULL;

-- [valid_from, valid_to): an empty period overlaps nothing, which is how a version dropped before it began stays on record
ALTER TABLE "subscriber_tariff_periods" ADD CONSTRAINT "subscriber_tariff_periods_dates" CHECK ("valid_to" >= "valid_from");
ALTER TABLE "subscriber_tariff_periods" ADD CONSTRAINT "subscriber_tariff_periods_no_overlap"
  EXCLUDE USING gist ("subscriber_id" WITH =, daterange("valid_from", "valid_to", '[)') WITH &&);

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_phone_format" CHECK ("phone" ~ '^\+380\d{9}$');
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_phone2_format" CHECK ("phone2" ~ '^\+380\d{9}$');
-- At most one by this index: at least one is the service's job, an empty client cannot be seen from a single row
CREATE UNIQUE INDEX "contacts_one_primary_idx" ON "contacts"("subscriber_id") WHERE "is_primary" AND "archived_at" IS NULL;
CREATE INDEX "contacts_phone_rev_idx" ON "contacts"("phone_rev" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "contacts_phone2_rev_idx" ON "contacts"("phone2_rev" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "contacts_email_idx" ON "contacts"("email") WHERE "archived_at" IS NULL;
CREATE INDEX "contacts_full_name_norm_trgm_idx" ON "contacts" USING gin ("full_name_norm" gin_trgm_ops) WHERE "archived_at" IS NULL;

ALTER TABLE "payers" ADD CONSTRAINT "payers_tax_id_format" CHECK ("tax_id" ~ '^(\d{8}|\d{10})$');
-- payers.md П8: the same rule as paymentProblems in packages/shared
ALTER TABLE "payers" ADD CONSTRAINT "payers_method_fields" CHECK (CASE "payment_method"
  WHEN 'invoice' THEN "legal_name" IS NOT NULL AND "tax_id" IS NOT NULL
  WHEN 'vchasno' THEN "legal_name" IS NOT NULL AND "tax_id" IS NOT NULL AND "vchasno_email" IS NOT NULL
  WHEN 'iban' THEN "details_contact" IS NOT NULL
END);
CREATE INDEX "payers_tax_id_idx" ON "payers"("tax_id" text_pattern_ops) WHERE "archived_at" IS NULL;
CREATE INDEX "payers_name_norm_trgm_idx" ON "payers" USING gin ("name_norm" gin_trgm_ops) WHERE "archived_at" IS NULL;

ALTER TABLE "contracts" ADD CONSTRAINT "contracts_valid_until_after_signing" CHECK ("valid_until" >= "signed_on");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_terminated_after_signing" CHECK ("terminated_on" >= "signed_on");
-- An archived contract gives its number back, as an archived record does everywhere (contracts.md П7, §3.3)
CREATE UNIQUE INDEX "contracts_payer_id_number_norm_idx" ON "contracts"("payer_id", "number_norm") WHERE "archived_at" IS NULL;
-- The check of a number asks across payers, and a short number gives the trigram index nothing to go by
CREATE INDEX "contracts_number_norm_idx" ON "contracts"("number_norm") WHERE "archived_at" IS NULL;
CREATE INDEX "contracts_signed_on_id_idx" ON "contracts"("signed_on" DESC, "id" DESC) WHERE "archived_at" IS NULL;
CREATE INDEX "contracts_valid_until_id_idx" ON "contracts"("valid_until", "id") WHERE "archived_at" IS NULL;
CREATE INDEX "contracts_number_norm_trgm_idx" ON "contracts" USING gin ("number_norm" gin_trgm_ops) WHERE "archived_at" IS NULL;
