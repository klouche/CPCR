-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "regional" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hidden" TEXT,
    "description" TEXT,
    "complement" TEXT,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "research" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phase" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "output" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "url" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "docs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contact" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);
