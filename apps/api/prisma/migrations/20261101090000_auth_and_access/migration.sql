-- Runtime role (06-quality.md §6.2.10): DML only, no DDL. A role belongs to the cluster, not to a database, so the test
-- database and Prisma's shadow database of the same cluster find it already there. No password here: src/setup.ts sets
-- it from the environment after every migrate. A dump holds these grants and not the role itself (RESTORE.md).
-- Default privileges come first, so every table of this and later migrations gets them from the owner that creates it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gps_crm_app') THEN
    CREATE ROLE gps_crm_app NOLOGIN NOINHERIT;
  END IF;
END
$$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gps_crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gps_crm_app;

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'active', 'blocked');

-- CreateEnum
CREATE TYPE "access_scope" AS ENUM ('all', 'own');

-- CreateEnum
CREATE TYPE "auth_token_type" AS ENUM ('invitation', 'password_reset', 'two_factor_challenge');

-- CreateEnum
CREATE TYPE "actor_kind" AS ENUM ('user', 'system');

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "access_scope" NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","key")
);

-- CreateTable
CREATE TABLE "user_permission_overrides" (
    "user_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "access_scope",
    "is_allowed" BOOLEAN NOT NULL,

    CONSTRAINT "user_permission_overrides_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "password_hash" TEXT,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "type" "auth_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_in_throttle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL,
    "first_failure_at" TIMESTAMPTZ NOT NULL,
    "last_failure_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sign_in_throttle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "two_factor_credentials" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ,
    "last_step" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "credential_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "actor_kind" "actor_kind" NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" UUID,
    "subscriber_id" UUID,
    "changes" JSONB,
    "snapshot" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "retention_class" TEXT NOT NULL DEFAULT 'standard',

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("occurred_at","id")
) PARTITION BY RANGE ("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "sessions_last_seen_at_idx" ON "sessions"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "auth_tokens_token_hash_key" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_type_idx" ON "auth_tokens"("user_id", "type");

-- CreateIndex
CREATE INDEX "auth_tokens_expires_at_idx" ON "auth_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "sign_in_throttle_last_failure_at_idx" ON "sign_in_throttle"("last_failure_at");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_credentials_user_id_key" ON "two_factor_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_recovery_codes_credential_id_code_hash_key" ON "two_factor_recovery_codes"("credential_id", "code_hash");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_credentials" ADD CONSTRAINT "two_factor_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "two_factor_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Objects outside the Prisma schema. Registered in src/core/db/schema-invariants.int.test.ts.

-- П3: unique regardless of case, because only one spelling can be stored
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- The journal: months in schema `part`, three ahead here and the rest from the job of step 2 (activity.partitions).
-- The default partition is the safety net: a month with no partition still writes.
CREATE TABLE part.activity_events_default PARTITION OF activity_events DEFAULT;
CREATE TABLE part.activity_events_2026_11 PARTITION OF activity_events
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE part.activity_events_2026_12 PARTITION OF activity_events
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
CREATE TABLE part.activity_events_2027_01 PARTITION OF activity_events
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

-- Insert and read only (activity.md П4). The partitions need no grant: a row reaches them through the parent.
REVOKE UPDATE, DELETE ON activity_events FROM gps_crm_app;

-- /health/ready reads it. Prisma's shadow database has no such table.
DO $$
BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    GRANT SELECT ON _prisma_migrations TO gps_crm_app;
  END IF;
END
$$;

-- Stage 1 gives every role every permission (D14). A new permission in packages/shared/src/permissions.ts needs a
-- migration like this one: access.int.test.ts fails without it.
INSERT INTO roles ("key", "name") VALUES
  ('admin', 'Адміністратор'),
  ('manager', 'Менеджер'),
  ('technician', 'Технічний спеціаліст');

INSERT INTO role_permissions ("role_id", "key", "scope")
SELECT roles.id, permission.key, 'all'
FROM roles
CROSS JOIN unnest(ARRAY[
  'subscribers.read', 'subscribers.write', 'subscribers.code.change',
  'objects.read', 'objects.write', 'objects.status.change',
  'equipment.read', 'equipment.write',
  'references.manage',
  'records.archive', 'records.delete',
  'data.export',
  'cost.read',
  'activity.read',
  'users.manage',
  'system.read'
]) AS permission(key);
