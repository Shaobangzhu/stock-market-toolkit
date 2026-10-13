// Test-only data. No runtime module imports these fixtures.
import type { DailyBar, PricePage } from '../../api/prices';
import { expectedSession } from './technical-analysis';
export function dailyBar(date: string, close = 100, basis: 'RAW' | 'TOTAL_RETURN' = 'RAW'): DailyBar {
  return { instrumentId: 'test-instrument', tradingDate: date, timestamp: `${date}T00:00:00.000Z`, retrievedAt: '2026-05-01T20:00:00.000Z', open: String(close - 0.5), high: String(close + 1), low: String(close - 1), close: String(close), volume: '1000', currency: 'USD', exchangeTimezone: 'America/New_York', provider: 'TIINGO', interval: 'DAY', adjustmentMode: basis, splitFactor: '1', dividendCash: '0', revision: 1 };
}
export function dailyHistory(): DailyBar[] {
  const bars: DailyBar[] = [];
  for (let t = Date.parse('2026-01-02'); t <= Date.parse('2026-04-30'); t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (expectedSession(date, 'NASDAQ')) bars.push(dailyBar(date, 100 + bars.length));
  }
  return bars;
}
export function pricePage(bars = dailyHistory(), symbol = 'TEST'): PricePage {
  return { instrument: { id: 'test-instrument', symbol, exchange: 'NASDAQ', currency: 'USD', exchangeTimezone: 'America/New_York' }, provider: 'TIINGO', interval: 'DAY', adjustmentMode: bars[0]?.adjustmentMode ?? 'RAW', bars, latestAvailableEod: bars.at(-1) ?? null, nextAfter: null, freshness: { lastSuccessAt: '2026-05-01T20:00:00.000Z', errorCode: null, calendarVerified: true } };
}
