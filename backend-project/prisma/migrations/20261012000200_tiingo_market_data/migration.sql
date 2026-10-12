ALTER TABLE "PriceBar"
  ADD COLUMN "sourceData" JSONB,
  ADD COLUMN "dividendCash" DECIMAL(24,8),
  ADD COLUMN "splitFactor" DECIMAL(30,12),
  ADD CONSTRAINT "PriceBar_corporate_actions_check" CHECK (
    ("dividendCash" IS NULL OR "dividendCash" >= 0) AND
    ("splitFactor" IS NULL OR "splitFactor" > 0));

ALTER TABLE "ProviderSyncJob" ADD COLUMN "resultSnapshot" JSONB;
CREATE UNIQUE INDEX "ProviderSyncJob_active_prices_key"
  ON "ProviderSyncJob" ("instrumentId", "provider", "dataset")
  WHERE "dataset" = 'PRICES' AND "status" IN ('QUEUED', 'RUNNING');

CREATE TABLE "ProviderRequestUsage" (
  "id" UUID NOT NULL,
  "provider" "SyncProvider" NOT NULL,
  "symbol" VARCHAR(32) NOT NULL,
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responseBytes" BIGINT NOT NULL CHECK ("responseBytes" >= 0),
  "errorCode" VARCHAR(64),
  "retryAfter" TIMESTAMPTZ(3),
  CONSTRAINT "ProviderRequestUsage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProviderRequestUsage_provider_requestedAt_idx"
  ON "ProviderRequestUsage" ("provider", "requestedAt");
