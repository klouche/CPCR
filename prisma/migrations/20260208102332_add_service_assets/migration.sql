-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('EMAIL', 'PHONE', 'URL', 'OTHER');

-- DropIndex
DROP INDEX "Service_organizationCode_idx";

-- CreateTable
CREATE TABLE "ServiceLink" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceDocument" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceContact" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "type" "ContactType" NOT NULL DEFAULT 'EMAIL',
    "value" TEXT NOT NULL,
    "label" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceClick" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "organizationCode" TEXT NOT NULL,
    "userOrganizationCode" TEXT,
    "isAuthenticated" BOOLEAN NOT NULL DEFAULT false,
    "referrer" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceLink_serviceId_order_idx" ON "ServiceLink"("serviceId", "order");

-- CreateIndex
CREATE INDEX "ServiceDocument_serviceId_order_idx" ON "ServiceDocument"("serviceId", "order");

-- CreateIndex
CREATE INDEX "ServiceContact_serviceId_order_idx" ON "ServiceContact"("serviceId", "order");

-- CreateIndex
CREATE INDEX "ServiceClick_serviceId_createdAt_idx" ON "ServiceClick"("serviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ServiceClick_organizationCode_createdAt_idx" ON "ServiceClick"("organizationCode", "createdAt");

-- AddForeignKey
ALTER TABLE "ServiceLink" ADD CONSTRAINT "ServiceLink_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDocument" ADD CONSTRAINT "ServiceDocument_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceContact" ADD CONSTRAINT "ServiceContact_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceClick" ADD CONSTRAINT "ServiceClick_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
