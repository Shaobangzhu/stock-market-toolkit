import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../config/env.js';
import type { MarketDataService } from './market-data.js';
import type { SecService } from './sec.js';
import { HttpError } from '../utils/http-error.js';
import { isSecConfigured } from '../providers/sec-edgar.js';

export const preferenceSchema = z.strictObject({ lookbackYears: z.number().int().min(1).max(20), detailLevel: z.enum(['concise', 'standard', 'detailed']), includeTechnical: z.boolean(), includeFundamentals: z.boolean(), includeNews: z.boolean(), monthlyBudgetUsd: z.string().regex(/^(0|[1-9]\d{0,5})(\.\d{1,2})?$/).nullable() });
export const defaultPreferences = { lookbackYears: 5, detailLevel: 'standard' as const, includeTechnical: true, includeFundamentals: true, includeNews: true, monthlyBudgetUsd: null };
const invalid = () => new HttpError(400, 'VALIDATION_ERROR', 'Invalid CSV. Use symbol,exchange,title,content columns and at most 100 notes for existing instruments.');
// RFC 4180 quoting, including embedded commas/newlines; bounded by the JSON request limit.
export function parseNoteCsv(text: string) {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } } else field += c; continue; }
    if (c === '"') { if (field || closed) throw invalid(); quoted = true; }
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else { if (closed) throw invalid(); field += c; }
  }
  if (quoted) throw invalid();
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  if (rows[0]?.join(',') !== 'symbol,exchange,title,content' || rows.length < 2 || rows.length > 101) throw invalid();
  const schema = z.tuple([z.string().regex(/^[A-Z][A-Z0-9.-]{0,31}$/), z.string().regex(/^[A-Z0-9_-]{1,32}$/), z.string().trim().min(1).max(160), z.string().trim().min(1).max(12000)]);
  return rows.slice(1).map(r => { const result = schema.safeParse(r); if (!result.success) throw invalid(); return result.data; });
}
export function createSettingsService(config: AppConfig, db?: PrismaClient, market?: MarketDataService, sec?: SecService, now = () => new Date()) {
  function database() { if (!db) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Configure and start the local PostgreSQL database.'); return db; }
  async function preferences() { const row = await database().appPreference.findUnique({ where: { key: 'research-preferences' } }); return row ? preferenceSchema.parse(row.value) : defaultPreferences; }
  const serialize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
  return {
    async overview() {
      const configured = { TIINGO: !!config.TIINGO_API_KEY, SEC_EDGAR: isSecConfigured(config.SEC_EDGAR_USER_AGENT), OPENAI: !!config.OPENAI_API_KEY };
      let health: { status: string; name: string | null; version: string | null; instruments: number | null; priceRecords: number | null; researchReports: number | null; earliestPriceDate: string | null; latestPriceDate: string | null; lastSync: string | null } = { status: 'Unavailable', name: null, version: null, instruments: null, priceRecords: null, researchReports: null, earliestPriceDate: null, latestPriceDate: null, lastSync: null };
      let pending: number | null = null;
      let providers = Object.entries(configured).map(([id, present]) => ({ id, configured: present, status: present ? 'Unknown / Not Tested' : 'Not Configured', lastSuccess: null as string | null, lastError: null as string | null, quota: null as unknown }));
      try {
        const client = database();
        const [engine, instruments, priceRecords, researchReports, dates, successes, jobs, requests, active, usage] = await Promise.all([
          client.$queryRaw<{ name: string; version: string }[]>`SELECT current_database() AS name, current_setting('server_version') AS version`, client.instrument.count(), client.priceBar.count(), client.researchRun.count({ where: { status: 'SUCCEEDED' } }), client.priceBar.aggregate({ _min: { tradingDate: true }, _max: { tradingDate: true } }),
          Promise.all((['TIINGO', 'SEC_EDGAR'] as const).map(provider => client.providerSyncState.aggregate({ where: { provider }, _max: { lastSuccessAt: true } }))),
          Promise.all((['TIINGO', 'SEC_EDGAR'] as const).map(provider => client.providerSyncJob.findFirst({ where: { provider, finishedAt: { not: null } }, orderBy: { finishedAt: 'desc' } }))),
          Promise.all((['TIINGO', 'SEC_EDGAR'] as const).map(provider => client.providerRequestUsage.findFirst({ where: { provider }, orderBy: { requestedAt: 'desc' } }))),
          client.providerSyncJob.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }), client.providerRequestUsage.count({ where: { provider: 'TIINGO', requestedAt: { gte: new Date(now().getTime() - 3600000) } } }),
        ]);
        const lastSync = successes.flatMap(s => s._max.lastSuccessAt ? [s._max.lastSuccessAt.toISOString()] : []).sort().at(-1) ?? null;
        health = { status: 'Connected', name: engine[0]!.name, version: engine[0]!.version, instruments, priceRecords, researchReports, earliestPriceDate: dates._min.tradingDate?.toISOString().slice(0, 10) ?? null, latestPriceDate: dates._max.tradingDate?.toISOString().slice(0, 10) ?? null, lastSync }; pending = active;
        providers = providers.map(p => {
          const index = p.id === 'TIINGO' ? 0 : p.id === 'SEC_EDGAR' ? 1 : -1;
          const lastSuccess = successes[index]?._max.lastSuccessAt?.toISOString() ?? null;
          const job = jobs[index], request = requests[index];
          const evidence = [job ? { date: job.finishedAt!, code: job.errorCode } : null, request ? { date: request.requestedAt, code: request.errorCode } : null].filter(v => v !== null).sort((a, b) => b.date.getTime() - a.date.getTime())[0];
          const code = evidence && (!lastSuccess || evidence.date >= new Date(lastSuccess)) ? evidence.code : null;
          return { ...p, lastSuccess, lastError: code, status: !p.configured ? 'Not Configured' : code === 'PROVIDER_RATE_LIMITED' ? 'Rate Limited' : code ? 'Error' : lastSuccess ? 'Online' : 'Unknown / Not Tested', quota: p.id === 'TIINGO' ? { requestsLastHour: usage, localHourlyBudget: config.TIINGO_MAX_REQUESTS_PER_HOUR, label: 'Local configured request budget; account usage elsewhere is unknown' } : null };
        });
      } catch { /* Honest degraded status; no credentials or driver diagnostics leave this service. */ }
      return { providers, database: health, pendingJobs: pending, availableProviders: providers.filter(p => p.status === 'Online').length, aiConfigured: configured.OPENAI, environment: { mode: 'local-only', frontendOrigin: config.FRONTEND_ORIGIN, backend: `http://${config.HOST}:${config.PORT}`, model: config.OPENAI_MODEL }, checkedAt: now().toISOString() };
    },
    preferences,
    async savePreferences(value: z.infer<typeof preferenceSchema>) { const parsed = preferenceSchema.parse(value); await database().appPreference.upsert({ where: { key: 'research-preferences' }, create: { key: 'research-preferences', value: parsed, schemaVersion: 1 }, update: { value: parsed, schemaVersion: 1 } }); return parsed; },
    async jobs(offset: number) { const rows = await database().providerSyncJob.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: 51, include: { instrument: { select: { symbol: true, exchange: true } } } }); return { jobs: rows.slice(0, 50).map(j => ({ id: j.id, symbol: j.instrument.symbol, exchange: j.instrument.exchange, provider: j.provider, dataset: j.dataset, status: j.status, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null, errorCode: j.errorCode, retryAfter: j.retryAfter?.toISOString() ?? null })), nextOffset: rows.length > 50 ? offset + 50 : null }; },
    async coverage(offset: number) { const stocks = await database().instrument.findMany({ orderBy: [{ symbol: 'asc' }, { exchange: 'asc' }], skip: offset, take: 51 }); return { instruments: await Promise.all(stocks.slice(0, 50).map(async s => ({ id: s.id, symbol: s.symbol, exchange: s.exchange, company: s.name, series: serialize(await database().priceBar.groupBy({ by: ['provider', 'interval', 'adjustmentMode', 'currency', 'exchangeTimezone'], where: { instrumentId: s.id }, _count: true, _min: { tradingDate: true }, _max: { tradingDate: true } })) }))), nextOffset: stocks.length > 50 ? offset + 50 : null }; },
    async syncWatchlist() {
      const stocks = await database().watchlistEntry.findMany({ include: { instrument: true }, take: 101 });
      if (stocks.length > 100) throw new HttpError(422, 'WATCHLIST_LIMIT', 'Batch synchronization supports at most 100 stocks.');
      const results = [];
      for (const { instrument } of stocks) { try { if (!market) throw new HttpError(503, 'PROVIDER_NOT_CONFIGURED', 'Market service unavailable.'); const cached = await database().priceBar.count({ where: { instrumentId: instrument.id, provider: 'TIINGO', adjustmentMode: 'RAW' } }); results.push({ symbol: instrument.symbol, job: await market.requestSync(instrument.symbol, { exchange: instrument.exchange, ...(!cached ? { fullHistory: true } : {}) }) }); } catch (e) { results.push({ symbol: instrument.symbol, errorCode: e instanceof HttpError ? e.code : 'DATABASE_UNAVAILABLE' }); } }
      return { results };
    },
    async retry(id: string) {
      const job = await database().providerSyncJob.findUnique({ where: { id }, include: { instrument: true } });
      if (!job) throw new HttpError(404, 'NOT_FOUND', 'Synchronization job not found.');
      if (!['FAILED', 'INTERRUPTED'].includes(job.status)) throw new HttpError(409, 'SYNC_CONFLICT', 'Only failed or interrupted jobs can be retried.');
      if (job.retryAfter && job.retryAfter > now()) throw new HttpError(429, 'PROVIDER_RATE_LIMITED', 'Wait until the recorded retry time.');
      if (job.provider === 'SEC_EDGAR' && sec) return sec.requestSync(job.instrument.symbol, { exchange: job.instrument.exchange });
      if (job.provider !== 'TIINGO' || !market) throw new HttpError(422, 'UNSUPPORTED_INSTRUMENT', 'This provider cannot be retried here.');
      const request = z.object({ startDate: z.string().optional(), endDate: z.string().optional(), fullHistory: z.boolean().optional() }).parse(job.requestSnapshot);
      return market.requestSync(job.instrument.symbol, { exchange: job.instrument.exchange, ...(request.startDate ? { startDate: request.startDate } : {}), ...(request.endDate ? { endDate: request.endDate } : {}), ...(request.fullHistory !== undefined ? { fullHistory: request.fullHistory } : {}) });
    },
    async importCsv(csv: string) {
      const rows = parseNoteCsv(csv);
      return database().$transaction(async tx => {
        const ids = [];
        for (const [symbol, exchange, title, content] of rows) {
          const instrument = await tx.instrument.findUnique({ where: { symbol_exchange: { symbol, exchange } } }); if (!instrument) throw invalid();
          const note = await tx.researchNote.create({ data: { instrumentId: instrument.id, seriesId: randomUUID(), version: 1, content: JSON.stringify({ schemaVersion: 'research-note-v1', title, content, risks: [], catalysts: [], inputSnapshot: { dataCutoff: now().toISOString(), price: null, importSource: 'manual-note-csv-v1' } }), createdAt: now() } }); ids.push(note.id);
        }
        return { imported: ids.length, ids, schema: 'manual-note-csv-v1' };
      });
    },
    async exportResearch() {
      return database().$transaction(async tx => {
        const [instruments, reports, sources, scenarios, notes] = await Promise.all([tx.instrument.findMany({ take: 5001 }), tx.researchRun.findMany({ where: { status: 'SUCCEEDED' }, take: 5001 }), tx.researchSource.findMany({ where: { researchRun: { status: 'SUCCEEDED' } }, take: 5001 }), tx.entryScenario.findMany({ take: 5001 }), tx.researchNote.findMany({ take: 5001 })]);
        if ([instruments, reports, sources, scenarios, notes].some(rows => rows.length > 5000)) throw new HttpError(422, 'PAYLOAD_TOO_LARGE', 'Research export exceeds 5,000 rows per entity. Use a PostgreSQL backup for the complete database.');
        return serialize({ schemaVersion: 'research-export-v1', exportedAt: now().toISOString(), mode: 'local-only', numericEncoding: 'decimal strings', instruments, reports, sources, scenarios, notes });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
  };
}
export type SettingsService = ReturnType<typeof createSettingsService>;
