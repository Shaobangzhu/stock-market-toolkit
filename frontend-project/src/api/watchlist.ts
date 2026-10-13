import { ApiError, getApiJson, requestApiJson } from './client';
import { keepPreviousData } from '@tanstack/react-query';

export const STATUS_LABELS = { WATCHING: 'Watching', RESEARCHING: 'Researching', WAITING_FOR_ENTRY: 'Waiting for Entry', ARCHIVED: 'Archived' } as const;
export type ResearchStatus = keyof typeof STATUS_LABELS;
export interface WatchlistItem {
  id: string; instrumentId: string; symbol: string; company: string; exchange: string; currency: string;
  researchStatus: ResearchStatus; tags: string[]; notes: string; revision: number; addedAt: string; lastUpdatedAt: string;
  lastPrice: { value: string; tradingDate: string; retrievedAt: string; provider: string; adjustmentMode: string } | null;
  dailyChange: { value: string; percent: string } | null;
  range52Week: { low: string; high: string; through: string; coverage: string; basis: string } | null;
  fairValue: { lower: string; upper: string; currency: string; scenarioId: string; savedAt: string } | null;
  entryZone: { lower: string; upper: string; currency: string; scenarioId: string; method: string; savedAt: string; dataCutoff: string; basis: string } | null;
  distanceToEntry: string | null; fresh: boolean; freshness: string;
  sparkline: { tradingDate: string; close: string }[];
  latestResearch: { id: string; completedAt: string; version: number; summary: string | null } | null;
  lastSyncJob: { id: string; status: string; errorCode: string | null; retryAfter: string | null } | null;
}
export interface WatchlistResponse {
  items: WatchlistItem[]; total: number; filteredCount: number; availableTags: string[]; asOf: string;
  summary: { tracked: number; archived: number; nearEntry: number; researched: number; priced: number; fresh: number };
}
export interface Resolution { resolutionToken: string; symbol: string; company: string; exchange: string; currency: string; alreadyAdded: boolean; source: string; expiresAt: string }
export interface SearchResponse { results: { symbol: string; name: string }[]; warning: { code: string; message: string } | null }
export interface AddResponse { id: string; symbol: string; syncJob: { id: string; status: string } | null; syncError: { code: string; message: string } | null }
export interface WatchlistFilters { search: string; status: ResearchStatus | ''; tag: string; includeArchived: boolean; nearEntry: boolean; nearPercent: number; sort: string; direction: string }
export const DEFAULT_WATCHLIST_FILTERS: WatchlistFilters = { search: '', status: '', tag: '', includeArchived: false, nearEntry: false, nearPercent: 5, sort: 'symbol', direction: 'asc' };

function invalid(): never { throw new Error('The local data service returned an unexpected Watchlist response.'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Record<string, unknown>; }
function data(value: unknown) { return object(object(value).data); }
function text(value: unknown): asserts value is string { if (typeof value !== 'string') invalid(); }
function money(value: unknown) { if (typeof value !== 'string' || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) invalid(); }
function count(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(); }
function strings(value: unknown) { if (!Array.isArray(value) || !value.every(row => typeof row === 'string')) invalid(); }
export function decodeWatchlist(value: unknown): WatchlistResponse {
  const d = data(value); if (!Array.isArray(d.items) || d.items.length > 250) invalid();
  count(d.total); count(d.filteredCount); strings(d.availableTags); text(d.asOf);
  const summary = object(d.summary); for (const key of ['tracked', 'archived', 'nearEntry', 'researched', 'priced', 'fresh']) count(summary[key]);
  for (const input of d.items) {
    const row = object(input);
    for (const key of ['id', 'instrumentId', 'symbol', 'company', 'exchange', 'currency', 'notes', 'addedAt', 'lastUpdatedAt', 'freshness']) text(row[key]);
    if (typeof row.researchStatus !== 'string' || !(row.researchStatus in STATUS_LABELS) || typeof row.fresh !== 'boolean') invalid();
    strings(row.tags); count(row.revision);
    if (row.distanceToEntry !== null) money(row.distanceToEntry);
    if (row.lastPrice !== null) { const p = object(row.lastPrice); money(p.value); for (const k of ['tradingDate', 'retrievedAt', 'provider', 'adjustmentMode']) text(p[k]); }
    if (row.dailyChange !== null) { const p = object(row.dailyChange); money(p.value); money(p.percent); }
    if (row.range52Week !== null) { const r = object(row.range52Week); money(r.low); money(r.high); text(r.through); text(r.coverage); text(r.basis); }
    for (const key of ['fairValue', 'entryZone']) if (row[key] !== null) { const p = object(row[key]); money(p.lower); money(p.upper); text(p.currency); text(p.scenarioId); text(p.savedAt); if (key === 'entryZone') { text(p.method); text(p.dataCutoff); text(p.basis); } }
    if (!Array.isArray(row.sparkline) || row.sparkline.length > 60) invalid();
    for (const point of row.sparkline) { const p = object(point); text(p.tradingDate); money(p.close); }
    if (row.latestResearch !== null) { const r = object(row.latestResearch); text(r.id); text(r.completedAt); count(r.version); if (r.summary !== null) text(r.summary); }
    if (row.lastSyncJob !== null) { const j = object(row.lastSyncJob); text(j.id); text(j.status); if (j.errorCode !== null) text(j.errorCode); if (j.retryAfter !== null) text(j.retryAfter); }
  }
  return d as unknown as WatchlistResponse;
}
function decodeResolution(value: unknown): Resolution {
  const d = data(value); for (const key of ['resolutionToken', 'symbol', 'company', 'exchange', 'currency', 'source', 'expiresAt']) text(d[key]);
  if (typeof d.alreadyAdded !== 'boolean') invalid(); return d as unknown as Resolution;
}
function decodeSearch(value: unknown): SearchResponse {
  const d = data(value); if (!Array.isArray(d.results) || d.results.length > 20) invalid();
  for (const input of d.results) { const row = object(input); text(row.symbol); text(row.name); }
  if (d.warning !== null) { const warning = object(d.warning); text(warning.code); text(warning.message); }
  return d as unknown as SearchResponse;
}
function decodeAdd(value: unknown): AddResponse {
  const d = data(value); text(d.id); text(d.symbol);
  if (d.syncJob !== null) { const job = object(d.syncJob); text(job.id); text(job.status); }
  if (d.syncError !== null) { const err = object(d.syncError); text(err.code); text(err.message); }
  return d as unknown as AddResponse;
}
export function watchlistQuery(filters: WatchlistFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== '') params.set(key, String(value));
  return { queryKey: ['watchlist', filters] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => getApiJson(`/api/watchlist?${params}`, decodeWatchlist, signal), staleTime: 15_000, placeholderData: keepPreviousData,
    refetchInterval: (query: { state: { data: WatchlistResponse | undefined } }) => query.state.data?.items.some(row => ['QUEUED', 'RUNNING'].includes(row.lastSyncJob?.status ?? '')) ? 2000 : false as const };
}
export const searchInstruments = (query: string) => requestApiJson('POST', '/api/instruments/search', decodeSearch, { query });
export const resolveInstrument = (symbol: string) => requestApiJson('POST', '/api/instruments/resolve', decodeResolution, { symbol });
export const addWatchlist = (resolutionToken: string, startDate?: string) => requestApiJson('POST', '/api/watchlist', decodeAdd, { resolutionToken, ...(startDate ? { initialSync: { startDate } } : {}) });
const decodeAcknowledgement = (value: unknown) => { const d = data(value); text(d.id); return d; };
export const updateWatchlist = (row: WatchlistItem, changes: { researchStatus?: ResearchStatus; tags?: string[]; notes?: string }) => requestApiJson('PATCH', `/api/watchlist/${row.id}`, decodeAcknowledgement, { revision: row.revision, ...changes });
export const removeWatchlist = (id: string) => requestApiJson('DELETE', `/api/watchlist/${id}`, decodeAcknowledgement, {});
export const syncWatchlistStock = (row: WatchlistItem, startDate: string) => requestApiJson('POST', `/api/stocks/${encodeURIComponent(row.symbol)}/sync`, decodeAcknowledgement, { exchange: row.exchange, ...(!row.lastPrice ? { startDate } : {}) });
export function requestError(error: unknown) {
  const messages: Record<string, string> = {
    PROVIDER_NOT_CONFIGURED: 'Configure TIINGO_API_KEY in the backend environment file, then restart the backend.',
    PROVIDER_AUTH_FAILED: 'Tiingo rejected the configured key or permissions. Check backend configuration.',
    PROVIDER_RATE_LIMITED: 'Tiingo request limit reached. Wait for the cooldown and retry explicitly.',
    INVALID_SYMBOL: 'Tiingo does not support this ticker. Check the symbol and try again.',
    UNSUPPORTED_INSTRUMENT: 'This listing is outside the supported market coverage.',
    PROVIDER_INVALID_RESPONSE: 'The provider returned incomplete or unexpected data. Saved data has been preserved.',
    PROVIDER_UNAVAILABLE: 'Provider search is unavailable. Retry later, or resolve an exact ticker.',
    DATABASE_UNAVAILABLE: 'The local database is unavailable. Check PostgreSQL startup and migrations.',
    WATCHLIST_DUPLICATE: 'This listing is already in your Watchlist.',
    WATCHLIST_CONFLICT: 'Annotations changed in another view. Refresh the Watchlist before saving again.',
    RESOLUTION_EXPIRED: 'Identity confirmation expired. Resolve the stock again.',
    WATCHLIST_LIMIT: 'The local Watchlist limit has been reached.',
    AMBIGUOUS_SYMBOL: 'The ticker matches multiple listings. Review the exchange before adding.',
    VALIDATION_ERROR: 'Check your input and try again.', NOT_FOUND: 'This saved entry no longer exists. Refresh the Watchlist.',
  };
  return error instanceof ApiError ? messages[error.code] ?? 'The request could not be completed. Retry explicitly.' : 'The local data service could not be reached or returned an unexpected response.';
}
