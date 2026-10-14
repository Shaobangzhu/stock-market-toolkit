import { ApiError, getApiJson, requestApiJson } from './client';
export type CaseName = 'bear' | 'base' | 'bull';
export type EntryAssumption = { mode: 'MARGIN'; minimumSafety: string; maximumSafety: string } | { mode: 'MANUAL'; lower: string; upper: string };
type Common = { entry: EntryAssumption; hypotheticalPrice: string | null };
type Forecast = { factId: string; growthPercent: string; horizonYears: number; targetMultiple: string; discountPercent: string; shareBasisNote: string };
export type CaseAssumption = Common & ({ method: 'DIRECT'; fairValue: string; rationale: string } | ({ method: 'PE' } & Forecast) | ({ method: 'PS'; forecastShares: string } & Forecast));
export interface Assumptions { exchange: string; cutoff: string; cases: Record<CaseName, CaseAssumption> }
export interface ValuationSource { id: string; metric: 'EPS' | 'REVENUE'; value: string; unit: string; periodStart: string; periodEnd: string; availableAt: string; retrievedAt: string; accessionNumber: string; sourceUrl: string; concept: string; issuerTickerCount: number }
export interface Snapshot { instrument: { id: string; symbol: string; exchange: string; currency: string }; cutoff: string; price: { id: string; close: string; tradingDate: string; retrievedAt: string; provider: string; adjustmentMode: string; stale: boolean } | null; facts: ValuationSource[] }
export interface CaseResult { name: CaseName; method: string; fairValue: string; projectedMetric: string | null; terminalPrice: string | null; source: ValuationSource | null; entryZone: { lower: string; upper: string; mode: string }; currentPriceMarginOfSafetyPercent: string | null; currentPricePremiumPercent: string | null; plannedEntryMarginOfSafetyPercent: { atLower: string; atUpper: string }; hypotheticalMarginOfSafetyPercent: string | null; distanceToEntryPercent: string | null }
export interface Result { formulaVersion: string; currency: string; cases: CaseResult[]; fairValueRange: { lower: string; upper: string }; limitations: string[] }
export interface Calculation { assumptions: Assumptions; inputSnapshot: Snapshot; result: Result; hash: string }
export interface SavedScenario { id: string; seriesId: string; version: number; createdAt: string; assumptions: Assumptions; inputSnapshot: Snapshot; result: Result }
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Unexpected valuation response.'); return v as Record<string, unknown>; };
const data = (v: unknown) => object(object(v).data);
function result(v: unknown) {
  const r = object(v);
  if (r.formulaVersion !== 'valuation-v1' || !Array.isArray(r.cases) || r.cases.length !== 3 || !Array.isArray(r.limitations)) throw Error('Unsupported valuation result.');
  for (const c of r.cases) { const row = object(c); if (!['bear', 'base', 'bull'].includes(String(row.name)) || typeof row.fairValue !== 'string' || !/^\d+(\.\d+)?$/.test(row.fairValue)) throw Error('Invalid valuation price.'); }
  return r as unknown as Result;
}
const path = (symbol: string, action: string): `/api/${string}` => `/api/stocks/${encodeURIComponent(symbol)}/valuation/${action}`;
export const valuationQuery = (symbol: string, exchange: string) => ({ queryKey: ['stock', symbol, 'valuation', exchange], queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(path(symbol, `scenarios?exchange=${encodeURIComponent(exchange)}`), v => {
  const rows = object(v).data; if (!Array.isArray(rows)) throw Error('Invalid scenario history.');
  return rows.map(v => { const row = object(v); result(row.result); return row as unknown as SavedScenario; });
}, signal), retry: false });
export const valuationSources = (symbol: string, exchange: string, cutoff: string, enabled: boolean) => ({ queryKey: ['stock', symbol, 'valuation-sources', exchange, cutoff], enabled, queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(path(symbol, `sources?exchange=${encodeURIComponent(exchange)}&cutoff=${encodeURIComponent(cutoff)}`), v => {
  const d = data(v); if (!Array.isArray(d.facts) || !d.instrument || typeof d.cutoff !== 'string') throw Error('Invalid valuation sources.'); return d as unknown as Snapshot;
}, signal), retry: false });
export function calculateValuation(symbol: string, assumptions: Assumptions) { return requestApiJson('POST', path(symbol, 'calculate'), v => { const d = data(v); result(d.result); if (typeof d.hash !== 'string') throw Error('Missing calculation hash.'); return d as unknown as Calculation; }, assumptions); }
export function saveValuation(symbol: string, calculation: Calculation, saved?: SavedScenario) { return requestApiJson('POST', path(symbol, 'save'), v => { const d = data(v); result(d.result); return d as unknown as SavedScenario; }, { assumptions: calculation.assumptions, expectedHash: calculation.hash, ...(saved ? { seriesId: saved.seriesId, expectedVersion: saved.version } : {}) }); }
export function valuationError(error: unknown) { return error instanceof ApiError ? error.publicMessage ?? error.message : error instanceof Error ? error.message : 'Valuation unavailable.'; }
