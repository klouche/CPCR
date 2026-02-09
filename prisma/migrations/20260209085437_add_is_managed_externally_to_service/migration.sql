-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "isManagedExternally" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Service_organizationCode_isManagedExternally_idx" ON "Service"("organizationCode", "isManagedExternally");
