import { getApiJson, requestApiJson } from './client';
export interface Preferences { lookbackYears: number; detailLevel: 'concise' | 'standard' | 'detailed'; includeTechnical: boolean; includeFundamentals: boolean; includeNews: boolean; monthlyBudgetUsd: string | null }
export interface SettingsStatus { providers: { id: string; configured: boolean; status: string; lastSuccess: string | null; lastError: string | null; quota: { requestsLastHour: number; localHourlyBudget: number; label: string } | null }[]; database: { status: string; name: string | null; version: string | null; instruments: number | null; priceRecords: number | null; researchReports: number | null; earliestPriceDate: string | null; latestPriceDate: string | null; lastSync: string | null }; pendingJobs: number | null; availableProviders: number; aiConfigured: boolean; environment: { mode: string; frontendOrigin: string; backend: string; model: string }; checkedAt: string }
export interface SyncJob { id: string; symbol: string; exchange: string; provider: string; dataset: string; status: string; createdAt: string; finishedAt: string | null; errorCode: string | null; retryAfter: string | null }
export interface CoverageStock { id: string; symbol: string; exchange: string; company: string; series: { provider: string; interval: string; adjustmentMode: string; currency: string; exchangeTimezone: string; _count: number; _min: { tradingDate: string }; _max: { tradingDate: string } }[] }
function decode<T>(value: unknown): T { if (!value || typeof value !== 'object' || !('data' in value)) throw new Error('Unexpected settings response.'); return (value as { data: T }).data; }
export const settingsApi = {
  status: () => getApiJson('/api/settings/status', decode<SettingsStatus>),
  preferences: () => getApiJson('/api/settings/preferences', decode<Preferences>),
  savePreferences: (value: Preferences) => requestApiJson('POST', '/api/settings/preferences', decode<Preferences>, value),
  jobs: (offset: number) => getApiJson(`/api/settings/jobs?offset=${offset}`, decode<{ jobs: SyncJob[]; nextOffset: number | null }>),
  coverage: (offset: number) => getApiJson(`/api/settings/coverage?offset=${offset}`, decode<{ instruments: CoverageStock[]; nextOffset: number | null }>),
  syncWatchlist: () => requestApiJson('POST', '/api/settings/sync-watchlist', decode<{ results: { symbol: string; job?: { id: string }; errorCode?: string }[] }>, {}),
  syncStock: (stock: CoverageStock) => requestApiJson('POST', `/api/stocks/${encodeURIComponent(stock.symbol)}/sync`, decode<{ id: string }>, { exchange: stock.exchange, fullHistory: true }),
  retry: (jobId: string) => requestApiJson('POST', '/api/settings/retry-sync', decode<{ id: string }>, { jobId }),
  importCsv: (csv: string) => requestApiJson('POST', '/api/settings/import-csv', decode<{ imported: number }>, { csv }),
  exportResearch: () => getApiJson('/api/settings/export-research', decode<unknown>),
};
