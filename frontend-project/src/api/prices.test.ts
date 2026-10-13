import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodePricePage, pricesQuery } from './prices';
import { dailyBar, pricePage } from '../features/stocks/PriceVolume.fixtures';
afterEach(() => vi.unstubAllGlobals());
const wrap = (data: unknown) => ({ data });
const response = (data: unknown) => ({ ok: true, json: async () => wrap(data) });
describe('Cached OHLCV contracts', () => {
  it('preserves exact decimal strings, trading dates, adjustments, timestamps and aligned volume', () => {
    const page = pricePage([dailyBar('2026-01-05')]); expect(decodePricePage(wrap(page))).toEqual(page);
  });
  it('rejects invalid OHLC, duplicates, nonnumeric values, wrong currency/timezone/basis/identity and invalid dates', () => {
    for (const patch of [{ high: '1' }, { volume: 'NaN' }, { close: '0' }, { currency: 'EUR' }, { adjustmentMode: 'TOTAL_RETURN' }, { tradingDate: '2026-02-30' }, { exchangeTimezone: 'UTC' }, { instrumentId: 'other' }]) {
      const page = pricePage([dailyBar('2026-01-05')]); Object.assign(page.bars[0]!, patch); expect(() => decodePricePage(wrap(page))).toThrow();
    }
    expect(() => decodePricePage(wrap(pricePage([dailyBar('2026-01-05'), dailyBar('2026-01-05')])))).toThrow();
  });
  it('paginates all cached prices without providers, keeps adjustment series separate and tolerates adjusted API failure', async () => {
    const calls: string[] = []; vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      calls.push(path); const url = new URL(path, 'http://localhost');
      if (url.searchParams.get('adjustment') === 'total-return') return { ok: false, status: 503, json: async () => ({ error: { code: 'DATABASE_UNAVAILABLE' } }) };
      const first = dailyBar('2026-01-05'), last = dailyBar('2026-01-06');
      return response({ ...pricePage(url.searchParams.has('after') ? [last] : [first]), latestAvailableEod: last, nextAfter: url.searchParams.has('after') ? null : first.tradingDate });
    }));
    const result = await pricesQuery('TEST', 'NASDAQ', '2026-05-01', true).queryFn({ signal: new AbortController().signal });
    expect(result.raw.bars.map(b => b.tradingDate)).toEqual(['2026-01-05', '2026-01-06']); expect(result.adjustedUnavailable).toBe(true); expect(calls).toHaveLength(3);
  });
  it('fails a changing pagination snapshot and wrong symbols rather than silently mixing revisions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      const next = new URL(path, 'http://localhost').searchParams.has('after');
      return response({ ...pricePage([dailyBar(next ? '2026-01-06' : '2026-01-05')]), latestAvailableEod: { ...dailyBar('2026-01-06'), revision: next ? 2 : 1 }, nextAfter: next ? null : '2026-01-05' });
    }));
    await expect(pricesQuery('TEST', 'NASDAQ', '2026-05-01', true).queryFn({ signal: new AbortController().signal })).rejects.toThrow();
  });
});
