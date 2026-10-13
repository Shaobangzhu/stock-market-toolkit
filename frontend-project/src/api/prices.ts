import { getApiJson } from './client';

export type PriceBasis = 'RAW' | 'TOTAL_RETURN';
export interface DailyBar {
  instrumentId: string; tradingDate: string; timestamp: string; retrievedAt: string;
  open: string; high: string; low: string; close: string; volume: string;
  currency: string; exchangeTimezone: string; provider: 'TIINGO'; interval: 'DAY'; adjustmentMode: PriceBasis;
  splitFactor: string | null; dividendCash: string | null; revision: number;
}
export interface PricePage {
  instrument: { id: string; symbol: string; exchange: string; currency: string; exchangeTimezone: string };
  provider: 'TIINGO'; interval: 'DAY'; adjustmentMode: PriceBasis; bars: DailyBar[];
  latestAvailableEod: DailyBar | null; nextAfter: string | null;
  freshness: { lastSuccessAt: string | null; errorCode: string | null; calendarVerified: boolean };
}
const fail = (): never => { throw new Error('Historical OHLCV response is invalid or changed during pagination. Retry after synchronization finishes.'); };
function object(input: unknown): Record<string, unknown> { if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(); return input as Record<string, unknown>; }
export function isTradingDate(input: unknown): input is string {
  return typeof input === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input) && Number.isFinite(Date.parse(`${input}T00:00:00Z`)) && new Date(`${input}T00:00:00Z`).toISOString().slice(0, 10) === input;
}
export function chartNumber(input: string): number {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(input)) return fail();
  const value = Number(input); if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) return fail(); return value;
}
function bar(input: unknown, page: PricePage): DailyBar {
  const b = object(input);
  for (const key of ['instrumentId', 'timestamp', 'retrievedAt', 'currency', 'exchangeTimezone']) if (typeof b[key] !== 'string') fail();
  if (!isTradingDate(b.tradingDate) || !Number.isFinite(Date.parse(String(b.timestamp))) || !Number.isFinite(Date.parse(String(b.retrievedAt))) || !Number.isSafeInteger(b.revision) || Number(b.revision) < 1) fail();
  if (b.instrumentId !== page.instrument.id || b.currency !== page.instrument.currency || b.exchangeTimezone !== page.instrument.exchangeTimezone || b.provider !== 'TIINGO' || b.interval !== 'DAY' || b.adjustmentMode !== page.adjustmentMode) fail();
  const values = ['open', 'high', 'low', 'close', 'volume'].map(key => typeof b[key] === 'string' ? chartNumber(b[key]) : fail());
  const [o, h, l, c, v] = values as [number, number, number, number, number];
  if (Math.min(o, h, l, c) <= 0 || v < 0 || l > Math.min(o, c) || h < Math.max(o, c) || h < l) fail();
  for (const key of ['splitFactor', 'dividendCash']) if (b[key] !== null && (typeof b[key] !== 'string' || chartNumber(b[key]) < (key === 'splitFactor' ? Number.MIN_VALUE : 0))) fail();
  return b as unknown as DailyBar;
}
export function decodePricePage(input: unknown): PricePage {
  const d = object(object(input).data), instrument = object(d.instrument), freshness = object(d.freshness);
  for (const key of ['id', 'symbol', 'exchange', 'currency', 'exchangeTimezone']) if (typeof instrument[key] !== 'string' || !instrument[key]) fail();
  if (d.provider !== 'TIINGO' || d.interval !== 'DAY' || !['RAW', 'TOTAL_RETURN'].includes(String(d.adjustmentMode)) || !Array.isArray(d.bars) || d.bars.length > 5000 || (d.nextAfter !== null && !isTradingDate(d.nextAfter))) fail();
  if (typeof freshness.calendarVerified !== 'boolean' || (freshness.lastSuccessAt !== null && (typeof freshness.lastSuccessAt !== 'string' || !Number.isFinite(Date.parse(freshness.lastSuccessAt)))) || (freshness.errorCode !== null && typeof freshness.errorCode !== 'string')) fail();
  const page = d as unknown as PricePage;
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(instrument.exchangeTimezone) }).format(); } catch { fail(); }
  page.bars = (d.bars as unknown[]).map(value => bar(value, page));
  for (let i = 1; i < page.bars.length; i++) if (page.bars[i]!.tradingDate <= page.bars[i - 1]!.tradingDate) fail();
  page.latestAvailableEod = d.latestAvailableEod === null ? null : bar(d.latestAvailableEod, page);
  if (page.nextAfter !== null && page.nextAfter !== page.bars.at(-1)?.tradingDate) fail();
  return page;
}
async function loadSeries(symbol: string, exchange: string, to: string, basis: PriceBasis, signal: AbortSignal): Promise<PricePage> {
  let result: PricePage | undefined, after: string | null = null, fingerprint = '';
  for (let pageNumber = 0; pageNumber < 4; pageNumber++) {
    const params = new URLSearchParams({ exchange, to, adjustment: basis === 'RAW' ? 'raw' : 'total-return', limit: '5000' });
    if (after) params.set('after', after);
    const page = await getApiJson(`/api/stocks/${encodeURIComponent(symbol)}/prices?${params}`, decodePricePage, signal);
    if (page.instrument.symbol !== symbol || page.instrument.exchange !== exchange || page.adjustmentMode !== basis || page.bars.some(row => row.tradingDate > to || (after !== null && row.tradingDate <= after))) fail();
    const current = JSON.stringify([page.instrument, page.freshness.lastSuccessAt, page.latestAvailableEod]);
    if (result && current !== fingerprint) fail();
    if (!result) { result = { ...page, bars: [] }; fingerprint = current; }
    result.bars.push(...page.bars); result.nextAfter = page.nextAfter;
    if (!page.nextAfter) return result;
    after = page.nextAfter;
  }
  throw new Error('Cached history exceeds the 20,000-observation chart limit.');
}
export interface CachedPrices { raw: PricePage; adjusted: PricePage | null; adjustedUnavailable: boolean }
export const pricesQuery = (symbol: string, exchange: string, asOfDate: string, enabled: boolean) => ({
  queryKey: ['stock', symbol, 'prices', exchange, asOfDate] as const, enabled, staleTime: 30000, retry: false,
  queryFn: async ({ signal }: { signal: AbortSignal }): Promise<CachedPrices> => {
    const [raw, adjusted] = await Promise.allSettled([loadSeries(symbol, exchange, asOfDate, 'RAW', signal), loadSeries(symbol, exchange, asOfDate, 'TOTAL_RETURN', signal)]);
    if (raw.status === 'rejected') throw raw.reason;
    if (adjusted.status === 'fulfilled' && adjusted.value.instrument.id !== raw.value.instrument.id) fail();
    // Unchanged raw observations retain their original retrieval dates when an
    // adjusted series is rebased. Retrieval timestamps need not be identical.
    if (adjusted.status === 'fulfilled') {
      const paired = new Map(adjusted.value.bars.map(bar => [bar.tradingDate, bar]));
      if (raw.value.bars.some(bar => { const adjustedBar = paired.get(bar.tradingDate); return adjustedBar && (adjustedBar.currency !== bar.currency || adjustedBar.exchangeTimezone !== bar.exchangeTimezone); })) fail();
    }
    return { raw: raw.value, adjusted: adjusted.status === 'fulfilled' ? adjusted.value : null, adjustedUnavailable: adjusted.status === 'rejected' };
  },
});
