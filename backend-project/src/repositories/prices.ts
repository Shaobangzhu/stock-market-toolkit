import type { Prisma, PriceBar, MarketDataProvider, BarInterval, AdjustmentMode } from '../generated/prisma/client.js';
import { exactDecimal } from '../utils/decimal.js';

export interface PriceBarInput {
  instrumentId: string;
  provider: MarketDataProvider;
  interval: BarInterval;
  adjustmentMode: AdjustmentMode;
  timestamp: Date;
  tradingDate: Date;
  currency: string;
  exchangeTimezone: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  retrievedAt: Date;
  sourceHash: string;
}

export function priceRepository(db: Prisma.TransactionClient) {
  return {
    // Explicit corrections replace the current bar; reports keep input snapshots.
    save(input: PriceBarInput) {
      const data = { ...input,
        open: exactDecimal(input.open, 24, 8), high: exactDecimal(input.high, 24, 8),
        low: exactDecimal(input.low, 24, 8), close: exactDecimal(input.close, 24, 8),
        volume: exactDecimal(input.volume, 30, 8),
      };
      const { instrumentId, provider, interval, adjustmentMode, timestamp } = input;
      return db.priceBar.upsert({
        where: { instrumentId_provider_interval_adjustmentMode_timestamp: { instrumentId, provider, interval, adjustmentMode, timestamp } },
        create: data, update: { ...data, revision: { increment: 1 } },
      });
    },
  };
}

export function serializePriceBar(bar: PriceBar) {
  return { ...bar,
    open: bar.open.toFixed(), high: bar.high.toFixed(), low: bar.low.toFixed(), close: bar.close.toFixed(), volume: bar.volume.toFixed(),
    dividendCash: bar.dividendCash?.toFixed() ?? null, splitFactor: bar.splitFactor?.toFixed() ?? null,
    timestamp: bar.timestamp.toISOString(), tradingDate: bar.tradingDate.toISOString().slice(0, 10), retrievedAt: bar.retrievedAt.toISOString(),
  };
}
