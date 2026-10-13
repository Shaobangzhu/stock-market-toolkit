import { describe, expect, it } from 'vitest';
import { analyzeHistory, bollinger, ema, gapBetween, historicalVolatility, macd, rangeStart, rsi, sma, supportedRange, technicalMetrics } from './technical-analysis';
import { dailyBar, dailyHistory } from './PriceVolume.fixtures';
describe('Deterministic historical indicators', () => {
  it('hand-calculated SMA, SMA-seeded EMA and population Bollinger bands have correct warm-up', () => {
    expect(sma([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
    expect(ema([1, 2, 3, 4, 10], 3)).toEqual([null, null, 2, 3, 6.5]);
    const bands = bollinger([1, 2, 3], 3); expect(bands.middle).toEqual([null, null, 2]); expect(bands.upper[2]).toBeCloseTo(2 + 2 * Math.sqrt(2 / 3), 12);
  });
  it('Wilder RSI handles gains, losses, flat prices and independent mixed observations', () => {
    expect(rsi(Array(14).fill(1)).at(-1)).toBeNull();
    expect(rsi(Array.from({ length: 15 }, (_, i) => i + 1)).at(-1)).toBe(100);
    expect(rsi(Array.from({ length: 15 }, (_, i) => 20 - i)).at(-1)).toBe(0);
    expect(rsi(Array(15).fill(5)).at(-1)).toBe(50);
    // Published Wilder example: 14 differences seed RSI 70.464135; next RSI 66.249619.
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00];
    expect(rsi(closes)[14]).toBeCloseTo(70.464135, 5); expect(rsi(closes)[15]).toBeCloseTo(66.249619, 5);
  });
  it('MACD linear ramp has independently known line=7, signal=7, histogram=0 after 34 closes', () => {
    const values = Array.from({ length: 35 }, (_, i) => 100 + i), result = macd(values);
    expect(result.line[24]).toBeNull(); expect(result.line[25]).toBe(7); expect(result.signal[32]).toBeNull(); expect(result.signal[33]).toBe(7); expect(result.histogram[33]).toBe(0);
  });
  it('all recursive/window indicators reset at null gaps and never depend on future observations', () => {
    const values = [...Array.from({ length: 50 }, (_, i) => i + 1), null, ...Array(10).fill(100)];
    expect(ema(values, 20).at(-1)).toBeNull(); expect(rsi(values).at(-1)).toBeNull(); expect(macd(values).line.at(-1)).toBeNull(); expect(bollinger(values).upper.at(-1)).toBeNull();
    const prefix = Array.from({ length: 35 }, (_, i) => i + 1);
    expect(ema([...prefix, 9999], 20).slice(0, -1)).toEqual(ema(prefix, 20)); expect(rsi([...prefix, 9999]).slice(0, -1)).toEqual(rsi(prefix));
  });
  it('holidays/weekends are not gaps; missing verified sessions are gaps; raw splits reset rather than infer continuity', () => {
    expect(gapBetween('2026-01-16', '2026-01-20', 'NASDAQ')).toBe(false);
    expect(gapBetween('2026-01-05', '2026-01-07', 'NASDAQ')).toBe(true);
    const bars = [dailyBar('2026-01-05', 100), { ...dailyBar('2026-01-06', 50), splitFactor: '2' }];
    expect(analyzeHistory(bars, 'NASDAQ').rows).toHaveLength(3);
    const adjusted = bars.map(b => ({ ...b, adjustmentMode: 'TOTAL_RETURN' as const })); expect(analyzeHistory(adjusted, 'NASDAQ').rows).toHaveLength(2);
    const raw = technicalMetrics(bars, null, '2026-01-06', 'NASDAQ', analyzeHistory(bars, 'NASDAQ')); expect(raw.periodReturn).toBeNull(); expect(raw.drawdown).toBeNull();
  });
  it('return/drawdown use selected endpoints, and historical-date metrics do not read future closes', () => {
    const bars = [dailyBar('2026-01-05', 100), dailyBar('2026-01-06', 80), dailyBar('2026-01-07', 120)];
    const value = technicalMetrics(bars, null, '2026-01-06', 'NASDAQ', analyzeHistory(bars, 'NASDAQ'));
    expect(value.periodReturn).toBeCloseTo(-20); expect(value.drawdown).toBeCloseTo(-20); expect(value.high52).toBe(101); expect(value.averageVolume).toBe(1000);
  });
  it('30-return annual volatility uses sample SD; short or missing daily history gives N/A', () => {
    const logs = Array.from({ length: 30 }, (_, i) => i % 2 ? -0.01 : 0.01), prices = [100];
    for (const log of logs) prices.push(prices.at(-1)! * Math.exp(log));
    expect(historicalVolatility(prices)).toBeCloseTo(Math.sqrt(30 * 0.0001 / 29) * Math.sqrt(252) * 100, 10);
    expect(historicalVolatility(prices.slice(1))).toBeNull();
    const bars = dailyHistory(); bars.splice(-5, 1); expect(technicalMetrics(bars, null, bars.at(-1)!.tradingDate, 'NASDAQ', analyzeHistory(bars, 'NASDAQ')).volatility30).toBeNull();
  });
  it('clamps months, disables unsupported date ranges, but always permits MAX on short caches', () => {
    expect(rangeStart('2026-03-31', '1M')).toBe('2026-02-28'); expect(rangeStart('2024-02-29', '1Y')).toBe('2023-02-28');
    expect(supportedRange(dailyHistory(), '3M')).toBe(true); expect(supportedRange(dailyHistory(), '6M')).toBe(false); expect(supportedRange([dailyBar('2026-01-05')], 'MAX')).toBe(true);
  });
});
