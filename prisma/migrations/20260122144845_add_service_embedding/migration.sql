-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Embedding table (1 row per service)
CREATE TABLE IF NOT EXISTS "service_embedding" (
  "serviceId" TEXT PRIMARY KEY REFERENCES "Service"("id") ON DELETE CASCADE,
  "embedding" vector(384) NOT NULL,
  "model" TEXT NOT NULL,
  "dim" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Optional but recommended index for cosine similarity
CREATE INDEX IF NOT EXISTS "service_embedding_embedding_hnsw"
ON "service_embedding"
USING hnsw ("embedding" vector_cosine_ops);