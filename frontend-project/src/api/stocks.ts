import { getApiJson, requestApiJson } from './client';
import { decodeWatchlist, type WatchlistItem } from './watchlist';

export const PRICE_RANGES = ['1M', '3M', '6M', '1Y', '3Y', '5Y', 'MAX'] as const;
export type PriceRange = typeof PRICE_RANGES[number];
export function normalizeStockSymbol(value: string | undefined): string | null {
  const symbol = value?.trim().toUpperCase().replaceAll('.', '-') ?? '';
  return symbol.length <= 32 && /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(symbol) ? symbol : null;
}
export interface ResearchRecord { id: string; completedAt: string; type: string; version: number; dataCutoff: string; fairValue: { lower: string; upper: string; currency: string } | null }
export interface StockOverview {
  asOf: string; stock: WatchlistItem; inWatchlist: boolean; syncActive: boolean;
  company: { name: string; description: string | null; sector: string | null; industry: string | null; website: string | null; cik: string | null; secUrl: string | null };
  performance: { range: PriceRange; provider: string; interval: string; adjustmentMode: string; requestedFrom: string | null; observedFrom: string | null; through: string | null; observations: number; coverage: string;
    points: { tradingDate: string; close: string | null }[]; change: { value: string; percent: string } | null; volatility: string | null; volatilityMethod: string; averageVolume: string | null; volumeBasis: string; calendarVerified: boolean };
  marginOfSafety: string | null; marginOfSafetyReason: string; history: ResearchRecord[]; capabilities: { aiResearch: boolean; scenarioEditor: boolean };
  news: { headlines: { title: string; url: string; publishedAt: string | null }[]; bullishDrivers: CitedPoint[]; bearishRisks: CitedPoint[]; catalysts: CitedPoint[] };
}
export interface CitedPoint { text: string; sources: { title: string; url: string }[] }
export interface FinancialMetric { value: string | null; unit: string; derived: boolean; reason: string | null; method?: string; sources: { sourceUrl: string; periodStart: string | null; periodEnd: string; filedDate: string; availableAt: string; isAmendment: boolean }[] }
export interface Fundamentals {
  symbol: string; asOf: string; periods: { periodStart: string | null; periodEnd: string; periodKind: string; currency: string; metrics: Record<string, FinancialMetric> }[];
  valuation: { priceEarnings: FinancialMetric; priceSales: FinancialMetric; marketCapitalization?: FinancialMetric; marketObservation: { tradingDate: string; close: string; currency: string } | null };
  freshness: { status: string; lastSuccessAt: string | null; lastErrorCode: string | null }; limitations: string[];
}
export interface Filings { symbol: string; filings: { id: string; form: string; filedDate: string; reportPeriod: string | null; sourceUrl: string }[] }
function invalid(): never { throw new Error('The local stock service returned an unexpected response.'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function data(value: unknown) { return object(object(value).data); }
function text(value: unknown) { if (typeof value !== 'string') invalid(); }
function decimal(value: unknown) { if (value !== null && (typeof value !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value))) invalid(); }
function history(value: unknown) {
  if (!Array.isArray(value) || value.length > 50) invalid();
  for (const input of value) { const r = object(input); for (const k of ['id', 'completedAt', 'type', 'dataCutoff']) text(r[k]); if (!Number.isSafeInteger(r.version) || Number(r.version) < 1) invalid();
    if (r.fairValue !== null) { const f = object(r.fairValue); decimal(f.lower); decimal(f.upper); text(f.currency); } }
}
export function decodeOverview(value: unknown): StockOverview {
  const d = data(value); text(d.asOf);
  decodeWatchlist({ data: { items: [d.stock], total: 1, filteredCount: 1, availableTags: [], asOf: d.asOf, summary: { tracked: 0, archived: 0, nearEntry: 0, researched: 0, priced: 0, fresh: 0 } } });
  if (typeof d.inWatchlist !== 'boolean' || typeof d.syncActive !== 'boolean') invalid();
  const company = object(d.company); text(company.name); for (const k of ['description', 'sector', 'industry', 'website', 'cik', 'secUrl']) if (company[k] !== null) text(company[k]);
  const p = object(d.performance); for (const k of ['range', 'provider', 'interval', 'adjustmentMode', 'coverage', 'volatilityMethod', 'volumeBasis']) text(p[k]);
  for (const k of ['requestedFrom', 'observedFrom', 'through']) if (p[k] !== null) text(p[k]);
  if (!PRICE_RANGES.includes(p.range as PriceRange) || !['RAW', 'TOTAL_RETURN'].includes(String(p.adjustmentMode)) || typeof p.calendarVerified !== 'boolean' || !Number.isSafeInteger(p.observations)) invalid();
  if (!Array.isArray(p.points) || p.points.length > 40000) invalid();
  for (const point of p.points) { const row = object(point); text(row.tradingDate); decimal(row.close); }
  decimal(p.volatility); decimal(p.averageVolume); if (p.change !== null) { const c = object(p.change); decimal(c.value); decimal(c.percent); }
  decimal(d.marginOfSafety); text(d.marginOfSafetyReason); history(d.history);
  const news = object(d.news); if (!Array.isArray(news.headlines) || news.headlines.length > 10) invalid();
  for (const input of news.headlines) { const h = object(input); text(h.title); text(h.url); if (h.publishedAt !== null) text(h.publishedAt); }
  for (const key of ['bullishDrivers', 'bearishRisks', 'catalysts']) { const values = news[key]; if (!Array.isArray(values) || values.length > 10) invalid(); for (const input of values) { const p = object(input); text(p.text); if (!Array.isArray(p.sources) || p.sources.length < 1 || p.sources.length > 10) invalid(); for (const source of p.sources) { const s = object(source); text(s.title); text(s.url); } } }
  const capabilities = object(d.capabilities); if (typeof capabilities.aiResearch !== 'boolean' || typeof capabilities.scenarioEditor !== 'boolean') invalid();
  return d as unknown as StockOverview;
}
function metric(value: unknown) { const m = object(value); decimal(m.value); text(m.unit); if (m.reason !== null) text(m.reason); if (typeof m.derived !== 'boolean' || !Array.isArray(m.sources)) invalid();
  for (const input of m.sources) { const s = object(input); for (const k of ['sourceUrl', 'periodEnd', 'filedDate', 'availableAt']) text(s[k]); } }
export function decodeFundamentals(value: unknown): Fundamentals {
  const d = data(value); text(d.symbol); text(d.asOf); if (!Array.isArray(d.periods) || d.periods.length > 40) invalid();
  for (const input of d.periods) { const p = object(input); for (const k of ['periodEnd', 'periodKind', 'currency']) text(p[k]); if (p.periodStart !== null) text(p.periodStart); for (const m of Object.values(object(p.metrics))) metric(m); }
  const v = object(d.valuation); metric(v.priceEarnings); metric(v.priceSales); if (v.marketObservation !== null) { const m = object(v.marketObservation); text(m.tradingDate); decimal(m.close); text(m.currency); }
  if (v.marketCapitalization !== undefined) metric(v.marketCapitalization);
  const f = object(d.freshness); text(f.status); if (f.lastSuccessAt !== null) text(f.lastSuccessAt); if (f.lastErrorCode !== null) text(f.lastErrorCode);
  if (!Array.isArray(d.limitations) || !d.limitations.every(v => typeof v === 'string')) invalid(); return d as unknown as Fundamentals;
}
function decodeFilings(value: unknown): Filings { const d = data(value); text(d.symbol); if (!Array.isArray(d.filings) || d.filings.length > 200) invalid(); for (const input of d.filings) { const f = object(input); for (const k of ['id', 'form', 'filedDate', 'sourceUrl']) text(f[k]); if (f.reportPeriod !== null) text(f.reportPeriod); } return d as unknown as Filings; }
export const overviewQuery = (symbol: string, range: PriceRange) => ({ queryKey: ['stock', symbol, 'overview', range] as const, queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(`/api/stocks/${encodeURIComponent(symbol)}/overview?range=${range}`, decodeOverview, signal), staleTime: 15000,
  refetchInterval: (query: { state: { data: StockOverview | undefined } }) => query.state.data?.syncActive ? 2000 : false as const });
export const fundamentalsQuery = (symbol: string) => ({ queryKey: ['stock', symbol, 'fundamentals'] as const, queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(`/api/stocks/${encodeURIComponent(symbol)}/fundamentals?limit=40`, decodeFundamentals, signal), staleTime: 30000 });
export const filingsQuery = (symbol: string, limit = 5) => ({ queryKey: ['stock', symbol, 'filings', limit] as const, queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(`/api/stocks/${encodeURIComponent(symbol)}/filings?limit=${limit}`, decodeFilings, signal), staleTime: 30000 });
export const researchQuery = (symbol: string, enabled: boolean) => ({ queryKey: ['stock', symbol, 'history'] as const, enabled, queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(`/api/stocks/${encodeURIComponent(symbol)}/research?limit=50`, value => { const d = data(value); history(d.records); return d.records as ResearchRecord[]; }, signal), staleTime: 30000 });
export const syncStock = (stock: WatchlistItem, fullHistory: boolean) => requestApiJson('POST', `/api/stocks/${encodeURIComponent(stock.symbol)}/sync`, value => { const d = data(value); text(d.id); text(d.status); return { id: d.id as string, status: d.status as string }; }, { exchange: stock.exchange, ...(fullHistory ? { fullHistory: true } : {}) });
export const syncFundamentals = (stock: WatchlistItem) => requestApiJson('POST', `/api/stocks/${encodeURIComponent(stock.symbol)}/fundamentals/sync`, value => { const d = data(value); text(d.id); return { id: d.id as string }; }, { exchange: stock.exchange });
export const syncJobQuery = (id: string | null) => ({ queryKey: ['sync-job', id] as const, enabled: !!id, queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(`/api/sync-jobs/${id}`, value => { const d = data(value); text(d.status); return { status: d.status as string, errorCode: typeof d.errorCode === 'string' ? d.errorCode : null }; }, signal), refetchInterval: (query: { state: { data: { status: string } | undefined } }) => !query.state.data || ['QUEUED', 'RUNNING'].includes(query.state.data.status) ? 2000 : false as const });
export function safeOfficialUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined; try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && ['www.sec.gov', 'sec.gov'].includes(url.hostname)) return url.href; } catch { /* unavailable */ } return undefined;
}
export function safeResearchUrl(value: string): string | undefined { try { const url = new URL(value); if (url.protocol === 'https:' && !url.username && !url.password && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.href; } catch { /* invalid citation */ } return undefined; }
