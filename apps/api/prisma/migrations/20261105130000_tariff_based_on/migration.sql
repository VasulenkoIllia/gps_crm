-- A tariff made by «Нова версія тарифу» knows the tariff it was made from, so the list can say which is the newer one
-- (references.md П9, D88). Additive: tariffs made before this have no link, and nothing reads prices off it.

-- AlterTable
ALTER TABLE "tariffs" ADD COLUMN "based_on_id" UUID;

-- CreateIndex
CREATE INDEX "tariffs_based_on_id_idx" ON "tariffs"("based_on_id");

-- AddForeignKey
ALTER TABLE "tariffs" ADD CONSTRAINT "tariffs_based_on_id_fkey" FOREIGN KEY ("based_on_id") REFERENCES "tariffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
