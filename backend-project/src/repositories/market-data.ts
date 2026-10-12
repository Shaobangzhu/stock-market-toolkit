import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { NormalizedPrice } from '../providers/market-data.js';

export async function upsertMarketPrices(tx: Prisma.TransactionClient, instrument: { id: string; currency: string; exchangeTimezone: string }, jobId: string, bars: NormalizedPrice[]) {
  // Parameterized JSON recordsets avoid thousands of per-row round trips.
  for (let offset = 0; offset < bars.length; offset += 500) {
    const batch = JSON.stringify(bars.slice(offset, offset + 500).map((bar) => ({ ...bar,
      id: randomUUID(), instrumentId: instrument.id, currency: instrument.currency,
      exchangeTimezone: instrument.exchangeTimezone, syncJobId: jobId,
    })));
    await tx.$executeRaw`
      INSERT INTO "PriceBar" ("id", "instrumentId", "provider", "interval", "adjustmentMode", "timestamp", "tradingDate", "currency", "exchangeTimezone",
        "open", "high", "low", "close", "volume", "retrievedAt", "sourceHash", "sourceData", "dividendCash", "splitFactor", "syncJobId", "revision")
      SELECT "id", "instrumentId", "provider"::"MarketDataProvider", "interval"::"BarInterval", "adjustmentMode"::"AdjustmentMode", "timestamp", "tradingDate", "currency", "exchangeTimezone",
        "open", "high", "low", "close", "volume", "retrievedAt", "sourceHash", "sourceData", "dividendCash", "splitFactor", "syncJobId", 1
      FROM jsonb_to_recordset(${batch}::jsonb) AS r("id" uuid, "instrumentId" uuid, "provider" text, "interval" text, "adjustmentMode" text,
        "timestamp" timestamptz, "tradingDate" date, "currency" text, "exchangeTimezone" text, "open" numeric, "high" numeric, "low" numeric,
        "close" numeric, "volume" numeric, "retrievedAt" timestamptz, "sourceHash" text, "sourceData" jsonb, "dividendCash" numeric, "splitFactor" numeric, "syncJobId" uuid)
      ON CONFLICT ("instrumentId", "provider", "interval", "adjustmentMode", "timestamp") DO UPDATE SET
        "open" = EXCLUDED."open", "high" = EXCLUDED."high", "low" = EXCLUDED."low", "close" = EXCLUDED."close", "volume" = EXCLUDED."volume",
        "retrievedAt" = EXCLUDED."retrievedAt", "sourceHash" = EXCLUDED."sourceHash", "sourceData" = EXCLUDED."sourceData",
        "dividendCash" = EXCLUDED."dividendCash", "splitFactor" = EXCLUDED."splitFactor", "syncJobId" = EXCLUDED."syncJobId",
        "revision" = "PriceBar"."revision" + CASE WHEN "PriceBar"."sourceHash" IS DISTINCT FROM EXCLUDED."sourceHash" THEN 1 ELSE 0 END`;
  }
}
