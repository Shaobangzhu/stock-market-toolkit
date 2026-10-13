import { z } from 'zod';
import { Prisma, type PrismaClient, type PriceBar } from '../generated/prisma/client.js';
import { dateKey, dateValue } from '../providers/market-data.js';
import { validateDailyCalendar } from '../providers/us-daily-calendar.js';
import { readStockOverview } from '../repositories/stock-overview.js';
import { projectWatchlistEntry } from './watchlist.js';

const Decimal = Prisma.Decimal.clone({ precision: 80 });
export const overviewRange = z.enum(['1M', '3M', '6M', '1Y', '3Y', '5Y', 'MAX']);
export type OverviewRange = z.infer<typeof overviewRange>;
export function rangeStart(through: string, range: OverviewRange): string | null {
  if (range === 'MAX') return null;
  const date = dateValue(through), day = date.getUTCDate();
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '3Y': 36, '5Y': 60 }[range];
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last)); return dateKey(date);
}
export function pricePerformance(raw: PriceBar[], adjusted: PriceBar[], exchange: string, range: OverviewRange) {
  const through = raw[0] ? dateKey(raw[0].tradingDate) : null;
  const from = through ? rangeStart(through, range) : null;
  const selectedRaw = raw.filter(row => !from || dateKey(row.tradingDate) >= from).reverse();
  const adjustedByDate = new Map(adjusted.map(row => [dateKey(row.tradingDate), row]));
  // An incomplete adjusted series is never patched with raw observations.
  const completeAdjusted = selectedRaw.length > 0 && selectedRaw.every(row => adjustedByDate.has(dateKey(row.tradingDate)));
  const selected = completeAdjusted ? selectedRaw.map(row => adjustedByDate.get(dateKey(row.tradingDate))!) : selectedRaw;
  const adjustmentMode = completeAdjusted ? 'TOTAL_RETURN' : 'RAW';
  let calendarVerified = false;
  const first = selected[0], last = selected.at(-1);
  if (first && last) { try { calendarVerified = validateDailyCalendar(selected.map(row => dateKey(row.tradingDate)), exchange, dateKey(first.tradingDate), dateKey(last.tradingDate)).fullRequestedRangeVerified; } catch { /* cache gaps remain visible */ } }
  const comparable = completeAdjusted || (calendarVerified && selectedRaw.every(row => row.splitFactor?.eq(1)));
  const change = first && last && selected.length >= 2 && comparable ? { value: new Decimal(last.close.toFixed()).minus(first.close.toFixed()).toFixed(), percent: new Decimal(last.close.toFixed()).div(first.close.toFixed()).minus(1).mul(100).toDecimalPlaces(8).toFixed() } : null;
  // Read-only statistical display: sample standard deviation of daily log returns,
  // annualized with 252 sessions. Exact prices/monetary changes stay Decimal.
  let volatility: string | null = null;
  if (comparable && calendarVerified && selected.length >= 21) {
    const closes = selected.map(row => Number(row.close.toFixed()));
    if (closes.every(value => Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER)) {
      const returns = closes.slice(1).map((value, i) => Math.log(value / closes[i]!));
      const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      volatility = (Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252) * 100).toFixed(6);
    }
  }
  const points: { tradingDate: string; close: string | null }[] = [];
  selected.forEach((row, i) => {
    const previous = selected[i - 1];
    if (previous) { try {
      const checked = validateDailyCalendar([dateKey(previous.tradingDate), dateKey(row.tradingDate)], exchange, dateKey(previous.tradingDate), dateKey(row.tradingDate));
      if (!checked.fullRequestedRangeVerified && row.tradingDate.getTime() - previous.tradingDate.getTime() > 4 * 86400000) points.push({ tradingDate: `Gap before ${dateKey(row.tradingDate)}`, close: null });
    } catch { points.push({ tradingDate: `Gap before ${dateKey(row.tradingDate)}`, close: null }); } }
    points.push({ tradingDate: dateKey(row.tradingDate), close: row.close.toFixed() });
  });
  return { range, provider: 'TIINGO', interval: 'DAY', adjustmentMode, requestedFrom: from, observedFrom: first ? dateKey(first.tradingDate) : null, through,
    observations: selected.length, coverage: !first ? 'unavailable' : !calendarVerified || (from && raw.at(-1) && dateKey(raw.at(-1)!.tradingDate) > from) ? 'partial-or-unverified' : 'verified-stored-window',
    points, change, volatility, volatilityMethod: 'sample SD of daily log returns × √252 × 100; minimum 20 verified daily returns',
    averageVolume: selectedRaw.length ? selectedRaw.reduce((sum, row) => sum.plus(row.volume.toFixed()), new Decimal(0)).div(selectedRaw.length).toDecimalPlaces(8).toFixed() : null,
    volumeBasis: 'RAW shares; arithmetic mean over stored observations', calendarVerified };
}
const savedFair = z.object({ version: z.literal(1), adjustmentMode: z.literal('RAW'), fairValueLow: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,8})?$/), fairValueHigh: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,8})?$/) });
const citedPoint = z.object({ text: z.string().trim().min(1).max(2000), sourceIds: z.array(z.uuid()).min(1).max(10) });
const qualitativeProjection = z.object({ version: z.literal(1), bullishDrivers: z.array(citedPoint).max(10), bearishRisks: z.array(citedPoint).max(10), catalysts: z.array(citedPoint).max(10) });
function publicSourceUrl(value: string) {
  try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.href; } catch { /* invalid citation */ } return null;
}
export function createStockOverviewService(db: PrismaClient, now = () => new Date()) {
  async function read(symbol: string, exchange?: string) { return readStockOverview(db, symbol, exchange, now()); }
  function history(stored: Awaited<ReturnType<typeof read>>) {
    return stored.instrument.researchRuns.map(run => {
      const scenario = stored.reportScenarios.find(row => row.researchRunId === run.id);
      const output = scenario?.resultSnapshot as Record<string, unknown> | null;
      const fair = savedFair.safeParse(output?.watchlistProjection);
      return { id: run.id, completedAt: run.completedAt!.toISOString(), type: 'AI Report', version: run.version, dataCutoff: run.dataCutoff.toISOString(),
        fairValue: fair.success && new Decimal(fair.data.fairValueLow).gt(0) && new Decimal(fair.data.fairValueLow).lte(fair.data.fairValueHigh) ? { lower: fair.data.fairValueLow, upper: fair.data.fairValueHigh, currency: scenario!.currency } : null };
    });
  }
  return {
    async getOverview(symbol: string, range: OverviewRange, exchange?: string) {
      const at = now(), stored = await read(symbol, exchange);
      const projection = projectWatchlistEntry({ id: stored.membership?.id ?? stored.instrument.id, instrumentId: stored.instrument.id, addedAt: stored.membership?.addedAt ?? stored.instrument.createdAt, instrument: stored.instrument }, at);
      const lastJob = stored.instrument.syncJobs[0];
      const sourceMap = new Map(stored.researchSources.map(source => [source.id, source]));
      const reportOutput = stored.instrument.researchRuns[0]?.output as Record<string, unknown> | null;
      const qualitative = qualitativeProjection.safeParse(reportOutput?.overviewProjection);
      const points = (rows: z.infer<typeof citedPoint>[]) => rows.filter(row => row.sourceIds.every(id => sourceMap.has(id) && publicSourceUrl(sourceMap.get(id)!.url))).map(row => ({ text: row.text, sources: row.sourceIds.map(id => ({ title: sourceMap.get(id)!.title.slice(0, 500), url: publicSourceUrl(sourceMap.get(id)!.url)! })) }));
      const news = { headlines: stored.researchSources.filter(source => (source.evidenceSnapshot as Record<string, unknown> | null)?.sourceType === 'news' && publicSourceUrl(source.url)).slice(0, 10).map(source => ({ title: source.title.slice(0, 500), url: publicSourceUrl(source.url)!, publishedAt: source.publishedAt?.toISOString() ?? null })),
        bullishDrivers: qualitative.success ? points(qualitative.data.bullishDrivers) : [], bearishRisks: qualitative.success ? points(qualitative.data.bearishRisks) : [], catalysts: qualitative.success ? points(qualitative.data.catalysts) : [] };
      return { asOf: at.toISOString(), stock: projection, inWatchlist: !!stored.membership,
        syncActive: !!lastJob && ['QUEUED', 'RUNNING'].includes(lastJob.status) && at.getTime() - (lastJob.heartbeatAt ?? lastJob.createdAt).getTime() < 5 * 60000,
        company: { name: stored.instrument.name, description: null, sector: null, industry: null, website: null,
          cik: stored.issuer?.cik ?? null, secUrl: stored.issuer ? `https://www.sec.gov/edgar/browse/?CIK=${stored.issuer.cik}` : null },
        performance: pricePerformance(stored.instrument.priceBars, stored.adjusted, stored.instrument.exchange, range),
        marginOfSafety: null, marginOfSafetyReason: 'No approved saved margin-of-safety calculation is available.',
        history: history(stored).slice(0, 5), news, capabilities: { aiResearch: false, scenarioEditor: false } };
    },
    async getHistory(symbol: string, limit: number, exchange?: string) { return { symbol, records: history(await read(symbol, exchange)).slice(0, limit), limit, boundedTo: 50 }; },
  };
}
export type StockOverviewService = ReturnType<typeof createStockOverviewService>;
