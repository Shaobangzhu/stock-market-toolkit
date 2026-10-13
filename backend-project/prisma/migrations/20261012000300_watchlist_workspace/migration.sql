CREATE TYPE "WatchlistResearchStatus" AS ENUM ('WATCHING', 'RESEARCHING', 'WAITING_FOR_ENTRY', 'ARCHIVED');

CREATE TABLE "WatchlistDetails" (
  "id" UUID NOT NULL,
  "instrumentId" UUID NOT NULL,
  "researchStatus" "WatchlistResearchStatus" NOT NULL DEFAULT 'WATCHING',
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WatchlistDetails_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WatchlistDetails_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "WatchlistDetails_notes_check" CHECK (length("notes") <= 8000),
  CONSTRAINT "WatchlistDetails_tags_check" CHECK (cardinality("tags") <= 10)
);
CREATE UNIQUE INDEX "WatchlistDetails_instrumentId_key" ON "WatchlistDetails"("instrumentId");
CREATE INDEX "WatchlistDetails_researchStatus_idx" ON "WatchlistDetails"("researchStatus");
ALTER TABLE "WatchlistDetails" ADD CONSTRAINT "WatchlistDetails_instrumentId_fkey"
  FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
