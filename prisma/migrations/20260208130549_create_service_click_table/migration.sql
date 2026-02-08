-- Create ServiceClick table
CREATE TABLE "ServiceClick" (
  "id" TEXT NOT NULL,
  "serviceId" TEXT NOT NULL,
  "assetType" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "assetLabel" TEXT,
  "organizationCode" TEXT NOT NULL,
  "userOrganizationCode" TEXT,
  "isAuthenticated" BOOLEAN NOT NULL DEFAULT false,
  "referrer" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ServiceClick_pkey" PRIMARY KEY ("id")
);

-- Foreign key to Service
ALTER TABLE "ServiceClick"
ADD CONSTRAINT "ServiceClick_serviceId_fkey"
FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes
CREATE INDEX "ServiceClick_serviceId_createdAt_idx"
ON "ServiceClick" ("serviceId", "createdAt");

CREATE INDEX "ServiceClick_organizationCode_createdAt_idx"
ON "ServiceClick" ("organizationCode", "createdAt");