-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MarketDataProvider" AS ENUM ('TIINGO', 'TWELVE_DATA');

-- CreateEnum
CREATE TYPE "SyncProvider" AS ENUM ('TIINGO', 'TWELVE_DATA', 'SEC_EDGAR');

-- CreateEnum
CREATE TYPE "BarInterval" AS ENUM ('DAY', 'HOUR', 'MINUTE');

-- CreateEnum
CREATE TYPE "AdjustmentMode" AS ENUM ('RAW', 'SPLIT', 'TOTAL_RETURN');

-- CreateEnum
CREATE TYPE "SyncDataset" AS ENUM ('PRICES', 'FUNDAMENTALS', 'FILINGS');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'INTERRUPTED');

-- CreateTable
CREATE TABLE "Issuer" (
    "id" UUID NOT NULL,
    "cik" VARCHAR(10) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Issuer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" UUID NOT NULL,
    "symbol" VARCHAR(32) NOT NULL,
    "exchange" VARCHAR(32) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "exchangeTimezone" VARCHAR(64) NOT NULL,
    "issuerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistEntry" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceBar" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "provider" "MarketDataProvider" NOT NULL,
    "interval" "BarInterval" NOT NULL,
    "adjustmentMode" "AdjustmentMode" NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,
    "tradingDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "exchangeTimezone" VARCHAR(64) NOT NULL,
    "open" DECIMAL(24,8) NOT NULL,
    "high" DECIMAL(24,8) NOT NULL,
    "low" DECIMAL(24,8) NOT NULL,
    "close" DECIMAL(24,8) NOT NULL,
    "volume" DECIMAL(30,8) NOT NULL,
    "retrievedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceHash" CHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "syncJobId" UUID,

    CONSTRAINT "PriceBar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecFiling" (
    "id" UUID NOT NULL,
    "issuerId" UUID NOT NULL,
    "accessionNumber" VARCHAR(20) NOT NULL,
    "form" VARCHAR(32) NOT NULL,
    "filedDate" DATE NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "reportPeriod" DATE,
    "primaryDocumentUrl" TEXT NOT NULL,
    "isAmendment" BOOLEAN NOT NULL DEFAULT false,
    "retrievedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SecFiling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyFact" (
    "id" UUID NOT NULL,
    "issuerId" UUID NOT NULL,
    "filingId" UUID NOT NULL,
    "taxonomy" VARCHAR(64) NOT NULL,
    "concept" VARCHAR(256) NOT NULL,
    "unit" VARCHAR(64) NOT NULL,
    "value" DECIMAL(38,12) NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE NOT NULL,
    "fiscalYear" INTEGER,
    "fiscalPeriod" VARCHAR(8),
    "contextHash" CHAR(64) NOT NULL,
    "context" JSONB NOT NULL,
    "retrievedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanyFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSyncJob" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "dataset" "SyncDataset" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "requestSnapshot" JSONB NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "heartbeatAt" TIMESTAMPTZ(3),
    "retryAfter" TIMESTAMPTZ(3),
    "errorCode" VARCHAR(64),

    CONSTRAINT "ProviderSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSyncState" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "dataset" "SyncDataset" NOT NULL,
    "scopeKey" VARCHAR(128) NOT NULL,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastFailureAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(64),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "coverageStart" DATE,
    "coverageEnd" DATE,
    "freshThrough" TIMESTAMPTZ(3),
    "nextEligibleAt" TIMESTAMPTZ(3),
    "cursor" JSONB,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchRun" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "seriesId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "inputHash" CHAR(64) NOT NULL,
    "dataCutoff" TIMESTAMPTZ(3) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "promptVersion" VARCHAR(64) NOT NULL,
    "outputSchemaVersion" VARCHAR(64) NOT NULL,
    "output" JSONB,
    "errorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchSource" (
    "id" UUID NOT NULL,
    "researchRunId" UUID NOT NULL,
    "citationKey" VARCHAR(64) NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" VARCHAR(256),
    "publishedAt" TIMESTAMPTZ(3),
    "retrievedAt" TIMESTAMPTZ(3) NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,

    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchNote" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "researchRunId" UUID,
    "seriesId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryScenario" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "researchRunId" UUID,
    "seriesId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "method" VARCHAR(64) NOT NULL,
    "methodVersion" VARCHAR(64) NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "resultSnapshot" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "lowerPrice" DECIMAL(24,8),
    "upperPrice" DECIMAL(24,8),
    "dataCutoff" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppPreference" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AppPreference_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Issuer_cik_key" ON "Issuer"("cik");

-- CreateIndex
CREATE INDEX "Instrument_issuerId_idx" ON "Instrument"("issuerId");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_exchange_key" ON "Instrument"("symbol", "exchange");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistEntry_instrumentId_key" ON "WatchlistEntry"("instrumentId");

-- CreateIndex
CREATE INDEX "WatchlistEntry_addedAt_idx" ON "WatchlistEntry"("addedAt");

-- CreateIndex
CREATE INDEX "PriceBar_instrumentId_tradingDate_idx" ON "PriceBar"("instrumentId", "tradingDate");

-- CreateIndex
CREATE INDEX "PriceBar_syncJobId_idx" ON "PriceBar"("syncJobId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceBar_series_timestamp_key" ON "PriceBar"("instrumentId", "provider", "interval", "adjustmentMode", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "SecFiling_accessionNumber_key" ON "SecFiling"("accessionNumber");

-- CreateIndex
CREATE INDEX "SecFiling_issuerId_filedDate_idx" ON "SecFiling"("issuerId", "filedDate");

-- CreateIndex
CREATE INDEX "SecFiling_issuerId_reportPeriod_idx" ON "SecFiling"("issuerId", "reportPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "SecFiling_id_issuerId_key" ON "SecFiling"("id", "issuerId");

-- CreateIndex
CREATE INDEX "CompanyFact_issuerId_concept_periodEnd_idx" ON "CompanyFact"("issuerId", "concept", "periodEnd");

-- CreateIndex
CREATE INDEX "CompanyFact_filingId_issuerId_idx" ON "CompanyFact"("filingId", "issuerId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyFact_context_key" ON "CompanyFact"("filingId", "taxonomy", "concept", "unit", "contextHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSyncJob_idempotencyKey_key" ON "ProviderSyncJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProviderSyncJob_status_createdAt_idx" ON "ProviderSyncJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderSyncJob_instrumentId_provider_dataset_createdAt_idx" ON "ProviderSyncJob"("instrumentId", "provider", "dataset", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderSyncState_lastSuccessAt_idx" ON "ProviderSyncState"("lastSuccessAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderSyncState_scope_key" ON "ProviderSyncState"("instrumentId", "provider", "dataset", "scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_idempotencyKey_key" ON "ResearchRun"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ResearchRun_instrumentId_createdAt_idx" ON "ResearchRun"("instrumentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchRun_status_createdAt_idx" ON "ResearchRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_instrumentId_seriesId_version_key" ON "ResearchRun"("instrumentId", "seriesId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchRun_id_instrumentId_key" ON "ResearchRun"("id", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchSource_researchRunId_citationKey_key" ON "ResearchSource"("researchRunId", "citationKey");

-- CreateIndex
CREATE INDEX "ResearchNote_instrumentId_createdAt_idx" ON "ResearchNote"("instrumentId", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchNote_researchRunId_instrumentId_idx" ON "ResearchNote"("researchRunId", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchNote_instrumentId_seriesId_version_key" ON "ResearchNote"("instrumentId", "seriesId", "version");

-- CreateIndex
CREATE INDEX "EntryScenario_instrumentId_createdAt_idx" ON "EntryScenario"("instrumentId", "createdAt");

-- CreateIndex
CREATE INDEX "EntryScenario_researchRunId_instrumentId_idx" ON "EntryScenario"("researchRunId", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "EntryScenario_instrumentId_seriesId_version_key" ON "EntryScenario"("instrumentId", "seriesId", "version");

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistEntry" ADD CONSTRAINT "WatchlistEntry_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "ProviderSyncJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecFiling" ADD CONSTRAINT "SecFiling_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFact" ADD CONSTRAINT "CompanyFact_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyFact" ADD CONSTRAINT "CompanyFact_filingId_issuerId_fkey" FOREIGN KEY ("filingId", "issuerId") REFERENCES "SecFiling"("id", "issuerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSyncJob" ADD CONSTRAINT "ProviderSyncJob_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSyncState" ADD CONSTRAINT "ProviderSyncState_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_researchRunId_fkey" FOREIGN KEY ("researchRunId") REFERENCES "ResearchRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_researchRunId_instrumentId_fkey" FOREIGN KEY ("researchRunId", "instrumentId") REFERENCES "ResearchRun"("id", "instrumentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryScenario" ADD CONSTRAINT "EntryScenario_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryScenario" ADD CONSTRAINT "EntryScenario_researchRunId_instrumentId_fkey" FOREIGN KEY ("researchRunId", "instrumentId") REFERENCES "ResearchRun"("id", "instrumentId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks unsupported by Prisma's schema language. Preserve in migrations.
ALTER TABLE "Issuer" ADD CONSTRAINT "Issuer_cik_check" CHECK (cik ~ '^[0-9]{10}$');
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_identity_check" CHECK (
  symbol = upper(btrim(symbol)) AND length(symbol) > 0 AND
  exchange = upper(btrim(exchange)) AND length(exchange) > 0 AND currency ~ '^[A-Z]{3}$'
);
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_values_check" CHECK (
  open > 0 AND high > 0 AND low > 0 AND close > 0 AND volume >= 0 AND
  high >= greatest(open, close, low) AND low <= least(open, close, high) AND
  open::text <> 'NaN' AND high::text <> 'NaN' AND low::text <> 'NaN' AND close::text <> 'NaN' AND volume::text <> 'NaN' AND
  ("adjustmentMode" <> 'RAW' OR volume = trunc(volume)) AND revision > 0 AND currency ~ '^[A-Z]{3}$' AND
  "sourceHash" ~ '^[a-f0-9]{64}$'
);
ALTER TABLE "PriceBar" ADD CONSTRAINT "PriceBar_daily_date_check" CHECK (
  interval <> 'DAY' OR timestamp = ("tradingDate"::timestamp AT TIME ZONE 'UTC')
);
ALTER TABLE "SecFiling" ADD CONSTRAINT "SecFiling_accession_check" CHECK (
  "accessionNumber" ~ '^[0-9]{10}-[0-9]{2}-[0-9]{6}$' AND "primaryDocumentUrl" ~ '^https://'
);
ALTER TABLE "CompanyFact" ADD CONSTRAINT "CompanyFact_period_check" CHECK (
  ("periodStart" IS NULL OR "periodStart" <= "periodEnd") AND value::text <> 'NaN' AND "contextHash" ~ '^[a-f0-9]{64}$'
);
ALTER TABLE "ProviderSyncJob" ADD CONSTRAINT "ProviderSyncJob_state_check" CHECK (
  attempts >= 0 AND ("finishedAt" IS NULL OR "finishedAt" >= "createdAt") AND
  (status NOT IN ('SUCCEEDED','FAILED','INTERRUPTED') OR "finishedAt" IS NOT NULL) AND
  (status <> 'FAILED' OR "errorCode" IS NOT NULL) AND
  ((provider = 'SEC_EDGAR' AND dataset IN ('FILINGS','FUNDAMENTALS')) OR (provider <> 'SEC_EDGAR' AND dataset = 'PRICES'))
);
ALTER TABLE "ProviderSyncState" ADD CONSTRAINT "ProviderSyncState_coverage_check" CHECK (
  "consecutiveFailures" >= 0 AND length(btrim("scopeKey")) > 0 AND
  ("coverageStart" IS NULL OR "coverageEnd" IS NULL OR "coverageStart" <= "coverageEnd") AND
  ((provider = 'SEC_EDGAR' AND dataset IN ('FILINGS','FUNDAMENTALS')) OR (provider <> 'SEC_EDGAR' AND dataset = 'PRICES'))
);
ALTER TABLE "ResearchRun" ADD CONSTRAINT "ResearchRun_version_check" CHECK (
  version > 0 AND "inputHash" ~ '^[a-f0-9]{64}$' AND
  (status NOT IN ('SUCCEEDED','FAILED','INTERRUPTED') OR "completedAt" IS NOT NULL) AND
  (status <> 'SUCCEEDED' OR (output IS NOT NULL AND output <> 'null'::jsonb)) AND
  (status <> 'FAILED' OR "errorCode" IS NOT NULL)
);
ALTER TABLE "ResearchSource" ADD CONSTRAINT "ResearchSource_url_check" CHECK (url ~ '^https?://');
ALTER TABLE "ResearchNote" ADD CONSTRAINT "ResearchNote_version_check" CHECK (version > 0 AND length(btrim(content)) > 0);
ALTER TABLE "EntryScenario" ADD CONSTRAINT "EntryScenario_values_check" CHECK (
  version > 0 AND currency ~ '^[A-Z]{3}$' AND
  ("lowerPrice" IS NULL OR ("lowerPrice" > 0 AND "lowerPrice"::text <> 'NaN')) AND
  ("upperPrice" IS NULL OR ("upperPrice" > 0 AND "upperPrice"::text <> 'NaN')) AND
  ("lowerPrice" IS NULL OR "upperPrice" IS NULL OR "lowerPrice" <= "upperPrice")
);
ALTER TABLE "AppPreference" ADD CONSTRAINT "AppPreference_version_check" CHECK ("schemaVersion" > 0);

CREATE FUNCTION srl_check_timezone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW."exchangeTimezone") THEN
    RAISE EXCEPTION 'Invalid exchange timezone' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Instrument_timezone" BEFORE INSERT OR UPDATE ON "Instrument"
FOR EACH ROW EXECUTE FUNCTION srl_check_timezone();
CREATE TRIGGER "PriceBar_timezone" BEFORE INSERT OR UPDATE ON "PriceBar"
FOR EACH ROW EXECUTE FUNCTION srl_check_timezone();

CREATE FUNCTION srl_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saved versions are immutable; append a new version' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "ResearchNote_immutable" BEFORE UPDATE OR DELETE ON "ResearchNote"
FOR EACH ROW EXECUTE FUNCTION srl_immutable_version();
CREATE TRIGGER "EntryScenario_immutable" BEFORE UPDATE OR DELETE ON "EntryScenario"
FOR EACH ROW EXECUTE FUNCTION srl_immutable_version();

CREATE FUNCTION srl_preserve_research() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('SUCCEEDED','FAILED','INTERRUPTED') THEN
    RAISE EXCEPTION 'Research history is immutable' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."instrumentId", NEW."seriesId", NEW.version, NEW."inputSnapshot", NEW."inputHash", NEW."dataCutoff", NEW.model, NEW."promptVersion", NEW."outputSchemaVersion", NEW."idempotencyKey", NEW."createdAt", NEW.id)
    IS DISTINCT FROM ROW(OLD."instrumentId", OLD."seriesId", OLD.version, OLD."inputSnapshot", OLD."inputHash", OLD."dataCutoff", OLD.model, OLD."promptVersion", OLD."outputSchemaVersion", OLD."idempotencyKey", OLD."createdAt", OLD.id) THEN
    RAISE EXCEPTION 'Research inputs are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ResearchRun_preserve" BEFORE UPDATE OR DELETE ON "ResearchRun"
FOR EACH ROW EXECUTE FUNCTION srl_preserve_research();

CREATE FUNCTION srl_preserve_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_id uuid; run_status "RunStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Research sources are immutable' USING ERRCODE = '23514';
  END IF;
  run_id := NEW."researchRunId";
  SELECT status INTO run_status FROM "ResearchRun" WHERE id = run_id FOR UPDATE;
  IF run_status IN ('SUCCEEDED','FAILED','INTERRUPTED') THEN
    RAISE EXCEPTION 'Completed research sources are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ResearchSource_preserve" BEFORE INSERT OR UPDATE OR DELETE ON "ResearchSource"
FOR EACH ROW EXECUTE FUNCTION srl_preserve_sources();
