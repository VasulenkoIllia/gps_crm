-- Step 8 (06-quality.md §6.1, D84): the search of the archive by its own indexes. The search indexes hold the live
-- records only, so a search in the archive read the whole table: 110-130 ms a group on the seed of 1M, and the search
-- of the header reads several groups. These hold the archived rows only, a few per cent of each table.
-- A plain CREATE INDEX holds writes to the table while it builds: here the tables are small (staging has no real data,
-- D84). An index added once the tables are full goes CONCURRENTLY, one migration each (06-quality.md §6.3).
CREATE INDEX "subscribers_archived_name_norm_trgm_idx" ON "subscribers" USING gin ("name_norm" gin_trgm_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "objects_archived_name_norm_trgm_idx" ON "objects" USING gin ("name_norm" gin_trgm_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "contacts_archived_full_name_norm_trgm_idx" ON "contacts" USING gin ("full_name_norm" gin_trgm_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "contacts_archived_phone_rev_idx" ON "contacts"("phone_rev" text_pattern_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "contacts_archived_phone2_rev_idx" ON "contacts"("phone2_rev" text_pattern_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "devices_archived_imei_idx" ON "devices"("imei" text_pattern_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "devices_archived_imei_rev_idx" ON "devices"("imei_rev" text_pattern_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "sims_archived_iccid_idx" ON "sims"("iccid" text_pattern_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "sims_archived_iccid_rev_idx" ON "sims"("iccid_rev" text_pattern_ops) WHERE "archived_at" IS NOT NULL;

CREATE INDEX "sims_archived_msisdn_rev_idx" ON "sims"("msisdn_rev" text_pattern_ops) WHERE "archived_at" IS NOT NULL;
