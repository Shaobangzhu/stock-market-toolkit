import { getApiJson, requestApiJson } from './client';
import type { ResearchRecord } from './stocks';
export type ResearchKind = 'REPORT' | 'SCENARIO' | 'NOTE';
export const recordKind = (r: ResearchRecord): ResearchKind => r.kind ?? (r.type === 'Entry Scenario' ? 'SCENARIO' : r.type === 'Manual Thesis / Note' ? 'NOTE' : 'REPORT');
export interface HistoryFilter { symbol: string; exchange: string; all: boolean; search: string; kind: ResearchKind | ''; from: string; to: string; offset: number }
export interface HistoryPage { records: ResearchRecord[]; nextOffset: number | null }
export interface ResearchDetail {
  record: ResearchRecord; price: { value: string; tradingDate: string; currency: string; provider: string | null; adjustmentMode: string | null } | null;
  assumptions: unknown; entryZone: { lower: string; upper: string; currency: string } | null; marginOfSafety: string | null; plannedMarginOfSafety: unknown;
  analysis: unknown; thesis: string | null; risks: string[]; catalysts: string[]; bullishDrivers: string[];
  sources: { title: string; url: string; citationKey: string; publishedAt: string | null }[];
  notes: { id: string; version: number; createdAt: string; content: string; addedAfterReport: boolean }[];
  versions: { id: string; version: number; createdAt: string }[]; snapshot: { inputs: unknown; outputs: unknown; formulaVersion: string | null };
}
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Unexpected research response.'); return v as Record<string, unknown>; };
const payload = (v: unknown) => obj(obj(v).data);
function record(v: unknown): ResearchRecord { const r = obj(v); for (const k of ['id','completedAt','type','dataCutoff']) if (typeof r[k] !== 'string') throw Error('Invalid research record.'); if (!Number.isSafeInteger(r.version) || Number(r.version) < 1) throw Error('Invalid research version.'); return r as unknown as ResearchRecord; }
export const historyListQuery = (filter: HistoryFilter, enabled: boolean) => ({ queryKey: ['research-history', filter] as const, enabled, retry: false, queryFn: ({ signal }: { signal: AbortSignal }) => {
  const q = new URLSearchParams({ limit: '50', offset: String(filter.offset), ...(filter.all ? { trackedOnly:'true' } : { symbol:filter.symbol, exchange:filter.exchange }), ...(filter.search ? { search:filter.search } : {}), ...(filter.kind ? { kind:filter.kind } : {}), ...(filter.from ? { from:filter.from } : {}), ...(filter.to ? { to:filter.to } : {}) });
  return getApiJson(`/api/research/history?${q}`, v => { const d = payload(v); if (!Array.isArray(d.records) || d.records.length > 50 || d.nextOffset !== null && !Number.isSafeInteger(d.nextOffset)) throw Error('Invalid history page.'); return { records: d.records.map(record), nextOffset: d.nextOffset as number | null }; }, signal);
} });
export const historyDetailQuery = (r: ResearchRecord | null | undefined, enabled: boolean) => ({ queryKey: ['research-record', r ? recordKind(r) : '', r?.id] as const, enabled: enabled && !!r, retry: false, queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(`/api/research/records/${recordKind(r!)}/${encodeURIComponent(r!.id)}`, v => {
  const d = payload(v); record(d.record); for (const key of ['risks','catalysts','bullishDrivers','sources','notes','versions']) if (!Array.isArray(d[key])) throw Error('Invalid research details.');
  if (!d.snapshot || !('analysis' in d) || !('price' in d)) throw Error('Missing original research snapshot.'); return d as unknown as ResearchDetail;
}, signal) });
export interface NoteDraft { exchange: string; title: string; content: string; risks: string[]; catalysts: string[]; seriesId?: string; expectedVersion?: number; researchRunId?: string }
export const saveResearchNote = (symbol: string, draft: NoteDraft) => requestApiJson('POST', `/api/stocks/${encodeURIComponent(symbol)}/notes`, v => { const d = payload(v); if (typeof d.id !== 'string' || d.kind !== 'NOTE') throw Error('Invalid saved note.'); return d as unknown as { id: string; kind: 'NOTE'; version: number }; }, draft);
