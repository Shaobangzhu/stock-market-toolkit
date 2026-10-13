// Isolated test payloads only; runtime modules must never import this file.
import type { StockOverview, Fundamentals } from '../../api/stocks';
export function overviewFixture(symbol = 'TEST'): StockOverview {
  return { asOf: '2026-01-07T20:00:00Z', inWatchlist: true, syncActive: false,
    stock: { id: '00000000-0000-4000-8000-000000000001', instrumentId: '00000000-0000-4000-8000-000000000002', symbol, company: `Company ${symbol}`, exchange: 'NASDAQ', currency: 'USD', researchStatus: 'WATCHING', tags: [], notes: '', revision: 1,
      addedAt: '2026-01-07T00:00:00Z', lastUpdatedAt: '2026-01-07T00:00:00Z', lastPrice: { value: '12', tradingDate: '2026-01-06', retrievedAt: '2026-01-07T00:00:00Z', provider: 'TIINGO', adjustmentMode: 'RAW' }, dailyChange: { value: '1', percent: '9.090909' }, range52Week: { low: '9', high: '13', through: '2026-01-06', coverage: 'partial', basis: 'TIINGO:DAY:RAW' }, fairValue: null, entryZone: null, distanceToEntry: null, fresh: false, freshness: 'stale', sparkline: [], latestResearch: null, lastSyncJob: null },
    company: { name: `Company ${symbol}`, description: null, sector: null, industry: null, website: null, cik: '0000000001', secUrl: 'https://www.sec.gov/edgar/browse/?CIK=0000000001' },
    performance: { range: '1Y', provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'TOTAL_RETURN', requestedFrom: '2025-01-06', observedFrom: '2026-01-02', through: '2026-01-06', observations: 3, coverage: 'partial-or-unverified', points: [{ tradingDate: '2026-01-02', close: '5' }, { tradingDate: '2026-01-05', close: '5.5' }, { tradingDate: '2026-01-06', close: '6' }], change: { value: '1', percent: '20' }, volatility: null, volatilityMethod: 'Test-only documented sample volatility', averageVolume: '1000', volumeBasis: 'RAW shares', calendarVerified: true },
    marginOfSafety: null, marginOfSafetyReason: 'No approved saved calculation.', history: [], news: { headlines: [], bullishDrivers: [], bearishRisks: [], catalysts: [] }, capabilities: { aiResearch: false, scenarioEditor: false } };
}
export function fundamentalsFixture(symbol = 'TEST'): Fundamentals {
  const missing = { value: null, unit: 'ratio', derived: true, reason: 'MISSING_COMPARABLE_FACT', sources: [] };
  return { symbol, asOf: '2026-01-07T20:00:00Z', periods: [], valuation: { priceEarnings: missing, priceSales: missing, marketObservation: null }, freshness: { status: 'unavailable', lastSuccessAt: null, lastErrorCode: null }, limitations: [] };
}
