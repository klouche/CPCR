/*
  Warnings:

  - You are about to drop the column `organization` on the `Service` table. All the data in the column will be lost.
  - Added the required column `organizationCode` to the `Service` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "service_embedding" DROP CONSTRAINT "service_embedding_serviceId_fkey";

-- DropIndex
DROP INDEX "service_embedding_embedding_hnsw";

-- AlterTable
ALTER TABLE "Service" DROP COLUMN "organization",
ADD COLUMN     "organizationCode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "service_embedding" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Organization" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "idPrefix" TEXT NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "organizationCode" TEXT NOT NULL,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_organizationCode_fkey" FOREIGN KEY ("organizationCode") REFERENCES "Organization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationCode_fkey" FOREIGN KEY ("organizationCode") REFERENCES "Organization"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_embedding" ADD CONSTRAINT "service_embedding_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
