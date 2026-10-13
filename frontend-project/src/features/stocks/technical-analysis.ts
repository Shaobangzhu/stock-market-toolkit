import type { PriceRange } from '../../api/stocks';
import { chartNumber, type DailyBar } from '../../api/prices';

export type Values = (number | null)[];
// Matches the backend US_DAILY_2026_v1 calendar; outside it, coverage is unverified.
const holidays = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);
const exchanges = new Set(['NASDAQ', 'NYSE', 'NYSE ARCA', 'NYSE MKT', 'NYSE AMERICAN', 'AMEX']);
export function expectedSession(date: string, exchange: string): boolean | null {
  if (!exchanges.has(exchange) || !date.startsWith('2026-')) return null;
  return ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && !holidays.has(date);
}
export function gapBetween(previous: string, current: string, exchange: string): boolean {
  if (expectedSession(previous, exchange) === null || expectedSession(current, exchange) === null) return Date.parse(current) - Date.parse(previous) > 4 * 86400000;
  for (let t = Date.parse(previous) + 86400000; t < Date.parse(current); t += 86400000) if (expectedSession(new Date(t).toISOString().slice(0, 10), exchange)) return true;
  return false;
}
export function rangeStart(through: string, range: PriceRange): string | null {
  if (range === 'MAX') return null;
  const date = new Date(`${through}T00:00:00Z`), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - ({ '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60 }[range]));
  date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  return date.toISOString().slice(0, 10);
}
export function supportedRange(bars: readonly DailyBar[], range: PriceRange): boolean {
  if (!bars.length) return false;
  const start = rangeStart(bars.at(-1)!.tradingDate, range);
  // A boundary weekend/holiday may be up to four days before the first observation.
  return start === null || Date.parse(bars[0]!.tradingDate) <= Date.parse(start) + 4 * 86400000;
}
export function sma(values: Values, period: number): Values {
  let window: number[] = [];
  return values.map(value => { if (value === null) { window = []; return null; } window.push(value); if (window.length > period) window.shift(); return window.length === period ? window.reduce((s, v) => s + v, 0) / period : null; });
}
export function ema(values: Values, period: number): Values {
  let seed: number[] = [], prior: number | null = null;
  return values.map(value => {
    if (value === null) { seed = []; prior = null; return null; }
    if (prior === null) { seed.push(value); if (seed.length < period) return null; prior = seed.reduce((s, v) => s + v, 0) / period; }
    else prior += (value - prior) * 2 / (period + 1);
    return prior;
  });
}
export function rsi(values: Values, period = 14): Values {
  let previous: number | null = null, gain = 0, loss = 0, count = 0;
  return values.map(value => {
    if (value === null) { previous = null; gain = loss = count = 0; return null; }
    if (previous === null) { previous = value; return null; }
    const delta = value - previous; previous = value; count++;
    if (count <= period) { gain += Math.max(delta, 0) / period; loss += Math.max(-delta, 0) / period; }
    else { gain = (gain * (period - 1) + Math.max(delta, 0)) / period; loss = (loss * (period - 1) + Math.max(-delta, 0)) / period; }
    if (count < period) return null;
    return loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
  });
}
export function bollinger(values: Values, period = 20) {
  const middle = sma(values, period); let window: number[] = [];
  const deviation = values.map((v, i) => { if (v === null) { window = []; return null; } window.push(v); if (window.length > period) window.shift(); return middle[i] === null ? null : Math.sqrt(window.reduce((s, x) => s + (x - middle[i]!) ** 2, 0) / period); });
  return { middle, upper: middle.map((v, i) => v === null ? null : v + 2 * deviation[i]!), lower: middle.map((v, i) => v === null ? null : v - 2 * deviation[i]!) };
}
export function macd(values: Values) {
  const fast = ema(values, 12), slow = ema(values, 26);
  const line = values.map((_, i) => fast[i] === null || slow[i] === null ? null : fast[i]! - slow[i]!);
  const signal = ema(line, 9);
  return { line, signal, histogram: line.map((v, i) => v === null || signal[i] === null ? null : v - signal[i]!) };
}
export interface AnalysisRow { date: string; bar: DailyBar | null; index: number | null }
export function analyzeHistory(bars: readonly DailyBar[], exchange: string) {
  const rows: AnalysisRow[] = [], closes: Values = [];
  bars.forEach((bar, index) => {
    const previous = bars[index - 1];
    const discontinuity = previous && (gapBetween(previous.tradingDate, bar.tradingDate, exchange) || (bar.adjustmentMode === 'RAW' && (bar.splitFactor === null || Number(bar.splitFactor) !== 1)));
    if (discontinuity) { rows.push({ date: `Gap / basis break before ${bar.tradingDate}`, bar: null, index: null }); closes.push(null); }
    rows.push({ date: bar.tradingDate, bar, index }); closes.push(chartNumber(bar.close));
  });
  return { rows, sma50: sma(closes, 50), sma200: sma(closes, 200), ema20: ema(closes, 20), bands: bollinger(closes), rsi: rsi(closes), macd: macd(closes) };
}
export type Analysis = ReturnType<typeof analyzeHistory>;
export function historicalVolatility(closes: readonly number[]): number | null {
  if (closes.length < 31) return null;
  const sample = closes.slice(-31), returns = sample.slice(1).map((c, i) => Math.log(c / sample[i]!));
  const mean = returns.reduce((s, v) => s + v, 0) / 30;
  return Math.sqrt(returns.reduce((s, v) => s + (v - mean) ** 2, 0) / 29) * Math.sqrt(252) * 100;
}
export function technicalMetrics(bars: readonly DailyBar[], from: string | null, to: string, exchange: string, analysis: Analysis) {
  const selected = bars.filter(b => (!from || b.tradingDate >= from) && b.tradingDate <= to);
  const first = selected[0], last = selected.at(-1);
  const comparable = !!first && !!last && selected.length > 1 && !selected.some((b, i) => i > 0 && (gapBetween(selected[i - 1]!.tradingDate, b.tradingDate, exchange) || (b.adjustmentMode === 'RAW' && (b.splitFactor === null || Number(b.splitFactor) !== 1))));
  const prices = selected.map(b => chartNumber(b.close));
  let peak = prices[0] ?? 0, drawdown = 0;
  for (const price of prices) { peak = Math.max(peak, price); drawdown = Math.min(drawdown, (price / peak - 1) * 100); }
  const yearStart = to && Number.isFinite(Date.parse(to)) ? rangeStart(to, '1Y')! : '';
  const year = bars.filter(b => b.tradingDate >= yearStart && b.tradingDate <= to);
  const tail = bars.filter(b => b.tradingDate <= to).slice(-31);
  const tailComparable = tail.length === 31 && tail.every((b, i) => expectedSession(b.tradingDate, exchange) === true && (i === 0 || (!gapBetween(tail[i - 1]!.tradingDate, b.tradingDate, exchange) && (b.adjustmentMode !== 'RAW' || (b.splitFactor !== null && Number(b.splitFactor) === 1)))));
  const at = analysis.rows.reduce((last, row, index) => row.bar !== null && row.bar.tradingDate <= to ? index : last, -1);
  return { high52: year.length ? Math.max(...year.map(b => chartNumber(b.high))) : null, low52: year.length ? Math.min(...year.map(b => chartNumber(b.low))) : null,
    fullYear: supportedRange(bars.filter(b => b.tradingDate <= to), '1Y'),
    averageVolume: selected.length ? selected.reduce((s, b) => s + chartNumber(b.volume), 0) / selected.length : null,
    volatility30: tailComparable ? historicalVolatility(tail.map(b => chartNumber(b.close))) : null,
    drawdown: comparable ? drawdown : null, periodReturn: comparable ? (prices.at(-1)! / prices[0]! - 1) * 100 : null,
    rsi: analysis.rsi[at] ?? null, macd: analysis.macd.line[at] ?? null, macdSignal: analysis.macd.signal[at] ?? null,
    observations: selected.length, firstDate: first?.tradingDate ?? null, lastDate: last?.tradingDate ?? null };
}
