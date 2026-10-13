import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { SecEdgarProvider } from '../providers/sec-edgar.js';
import { canonicalSymbol, dateKey, dateValue, ProviderError } from '../providers/market-data.js';
import { persistSecBundle } from '../repositories/sec.js';
import { analyzeFundamentals, type FactObservation, type ValuationInput } from './fundamental-analysis.js';
import { validateDailyCalendar } from '../providers/us-daily-calendar.js';
import { HttpError } from '../utils/http-error.js';
import { logger } from '../utils/logger.js';

export interface SecQuery { exchange?: string; asOf?: string; limit: number; after?: string; form?: string }
export interface SecSyncInput { exchange?: string }
// Missing acceptance times are not midnight publication: conservatively wait until
// the following day at 05:00 UTC (after end of the filed date in Eastern time).
export function filingAvailableAt(filing: { acceptedAt: Date | null; filedDate: Date }): Date {
  return filing.acceptedAt ?? new Date(filing.filedDate.getTime() + 29 * 60 * 60_000);
}
export function createSecService(db: PrismaClient, provider: SecEdgarProvider, now = () => new Date()) {
  let stopping = false;
  let queue: Promise<unknown> = Promise.resolve();
  const owned = new Set<string>();
  async function instrument(symbol: string, exchange?: string) {
    const matches = await db.instrument.findMany({ where: { symbol: canonicalSymbol(symbol), ...(exchange ? { exchange } : {}) }, include: { issuer: true }, take: 2 });
    if (!matches.length) throw new HttpError(404, 'NOT_FOUND', 'Add or explicitly resolve this instrument before SEC synchronization.');
    if (matches.length > 1) throw new HttpError(409, 'AMBIGUOUS_SYMBOL', 'Specify the listing exchange.');
    return matches[0]!;
  }
  async function freshness(instrumentId: string) {
    const state = await db.providerSyncState.findFirst({ where: { instrumentId, provider: 'SEC_EDGAR', dataset: 'FUNDAMENTALS', scopeKey: 'COMPANYFACTS_V1' } });
    return { provider: 'SEC_EDGAR', configured: provider.configured, lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
      lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null, lastFailureAt: state?.lastFailureAt?.toISOString() ?? null,
      lastErrorCode: state?.lastErrorCode ?? null, consecutiveFailures: state?.consecutiveFailures ?? 0,
      retryAfter: state?.nextEligibleAt?.toISOString() ?? null, status: !state?.lastSuccessAt ? 'unavailable' : state.lastErrorCode || now().getTime() - state.lastSuccessAt.getTime() > 24 * 3600000 ? 'stale' : 'cached',
      freshnessPolicy: 'cached snapshot; stale after 24 hours or failed refresh, never proof of no new SEC filings' };
  }
  async function run(id: string) {
    const job = await db.providerSyncJob.findUniqueOrThrow({ where: { id }, include: { instrument: { include: { issuer: true } } } });
    try {
      if (stopping) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'SEC synchronization stopped.');
      await db.providerSyncJob.update({ where: { id }, data: { status: 'RUNNING', startedAt: now(), heartbeatAt: now(), attempts: { increment: 1 } } });
      const bundle = await provider.retrieve(job.instrument.symbol, job.instrument.exchange, job.instrument.issuer?.cik);
      if (stopping) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'SEC synchronization stopped.');
      await db.$transaction(async (tx) => {
        const result = await persistSecBundle(tx, job.instrumentId, bundle);
        if (stopping) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'SEC synchronization stopped.');
        for (const dataset of ['FILINGS', 'FUNDAMENTALS'] as const) {
          const scopeKey = dataset === 'FILINGS' ? 'SUBMISSIONS_V1' : 'COMPANYFACTS_V1';
          const key = { instrumentId: job.instrumentId, provider: 'SEC_EDGAR' as const, dataset, scopeKey };
          const dates = bundle.filings.map((row) => row.filedDate).sort();
          const data = { lastAttemptAt: job.createdAt, lastSuccessAt: bundle.retrievedAt, lastErrorCode: null, consecutiveFailures: 0, nextEligibleAt: null,
            ...(dates.length ? { coverageStart: dateValue(dates[0]!), coverageEnd: dateValue(dates.at(-1)!) } : {}), cursor: result };
          await tx.providerSyncState.upsert({ where: { instrumentId_provider_dataset_scopeKey: key }, create: { ...key, ...data }, update: data });
        }
        await tx.providerSyncJob.update({ where: { id }, data: { status: 'SUCCEEDED', finishedAt: now(), heartbeatAt: now(), resultSnapshot: result } });
      }, { timeout: 60_000, maxWait: 5000 });
    } catch (error) {
      const failure = error instanceof ProviderError || error instanceof HttpError ? error : new HttpError(503, 'DATABASE_UNAVAILABLE', 'SEC storage is unavailable.');
      try {
        await db.$transaction(async (tx) => {
          const at = now();
          await tx.providerSyncJob.update({ where: { id }, data: { status: stopping ? 'INTERRUPTED' : 'FAILED', finishedAt: at, errorCode: failure.code, retryAfter: error instanceof ProviderError ? error.retryAfter ?? null : null } });
          for (const dataset of ['FILINGS', 'FUNDAMENTALS'] as const) {
            const key = { instrumentId: job.instrumentId, provider: 'SEC_EDGAR' as const, dataset, scopeKey: dataset === 'FILINGS' ? 'SUBMISSIONS_V1' : 'COMPANYFACTS_V1' };
            const fields = { lastAttemptAt: job.createdAt, lastFailureAt: at, lastErrorCode: failure.code, nextEligibleAt: error instanceof ProviderError ? error.retryAfter ?? null : null };
            await tx.providerSyncState.upsert({ where: { instrumentId_provider_dataset_scopeKey: key }, create: { ...key, ...fields, consecutiveFailures: 1 }, update: { ...fields, consecutiveFailures: { increment: 1 } } });
          }
        });
      } catch { logger.error({ event: 'sync_failure_persistence_failed', code: 'DATABASE_UNAVAILABLE' }); }
    }
  }
  const heartbeat = setInterval(() => {
    if (owned.size) void db.providerSyncJob.updateMany({ where: { id: { in: [...owned] }, status: { in: ['QUEUED', 'RUNNING'] } }, data: { heartbeatAt: now() } }).catch(() => {});
  }, 30_000).unref();
  return {
    async requestSync(symbol: string, input: SecSyncInput) {
      if (stopping) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'SEC synchronization is stopping.');
      if (!provider.configured) throw new ProviderError(503, 'PROVIDER_NOT_CONFIGURED', 'Configure a real SEC contact User-Agent before synchronization.');
      const stock = await instrument(symbol, input.exchange);
      const job = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(70011204)`;
        const stale = new Date(now().getTime() - 5 * 60_000);
        await tx.providerSyncJob.updateMany({ where: { provider: 'SEC_EDGAR', status: { in: ['QUEUED', 'RUNNING'] }, OR: [{ heartbeatAt: { lt: stale } }, { heartbeatAt: null, createdAt: { lt: stale } }] },
          data: { status: 'INTERRUPTED', finishedAt: now(), errorCode: 'PROVIDER_UNAVAILABLE' } });
        const active = await tx.providerSyncJob.findFirst({ where: { instrumentId: stock.id, provider: 'SEC_EDGAR', dataset: 'FUNDAMENTALS', status: { in: ['QUEUED', 'RUNNING'] } } });
        if (active) return active;
        if (await tx.providerSyncJob.count({ where: { provider: 'SEC_EDGAR', status: { in: ['QUEUED', 'RUNNING'] } } }) >= 10) throw new ProviderError(429, 'SYNC_BUSY', 'SEC synchronization queue is full.');
        return tx.providerSyncJob.create({ data: { instrumentId: stock.id, provider: 'SEC_EDGAR', dataset: 'FUNDAMENTALS', idempotencyKey: randomUUID(), createdAt: now(), heartbeatAt: now(),
          requestSnapshot: { version: 1, symbol: stock.symbol, exchange: stock.exchange, scope: 'companyfacts-and-submissions' } } });
      });
      if (!owned.has(job.id) && job.status === 'QUEUED') {
        // PostgreSQL admission owns newly created jobs; avoid replaying another process's queued job.
        const claim = await db.providerSyncJob.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: now(), heartbeatAt: now() } });
        if (claim.count) {
          owned.add(job.id);
          queue = queue.then(() => run(job.id)).catch(() => logger.error({ event: 'sync_failure_persistence_failed', code: 'DATABASE_UNAVAILABLE' })).finally(() => owned.delete(job.id));
        }
      }
      return { id: job.id, provider: 'SEC_EDGAR', status: job.status, createdAt: job.createdAt.toISOString() };
    },
    async getFilings(symbol: string, query: SecQuery) {
      const stock = await instrument(symbol, query.exchange), cutoff = query.asOf ? new Date(query.asOf) : now();
      const all = stock.issuerId ? await db.secFiling.findMany({ where: { issuerId: stock.issuerId, ...(query.form ? { form: { in: [query.form, `${query.form}/A`] } } : {}) }, orderBy: [{ filedDate: 'desc' }, { accessionNumber: 'desc' }], take: 100001 }) : [];
      if (all.length > 100000) throw new HttpError(422, 'PROVIDER_NO_DATA', 'Filing history exceeds the local read bound.');
      const known = all.filter((row) => filingAvailableAt(row) <= cutoff);
      let start = 0;
      if (query.after) { const index = known.findIndex((row) => row.id === query.after); if (index < 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid filing cursor for this query.'); start = index + 1; }
      const page = known.slice(start, start + query.limit);
      return { symbol: stock.symbol, cik: stock.issuer?.cik ?? null, asOf: cutoff.toISOString(), provider: 'SEC_EDGAR',
        filings: page.map((row) => ({ id: row.id, accessionNumber: row.accessionNumber, form: row.form, isAmendment: row.isAmendment, filedDate: dateKey(row.filedDate),
          acceptedAt: row.acceptedAt?.toISOString() ?? null, availableAt: filingAvailableAt(row).toISOString(), publicationPrecision: row.acceptedAt ? 'acceptance-time' : 'conservative-filed-date',
          reportPeriod: row.reportPeriod ? dateKey(row.reportPeriod) : null, sourceUrl: row.primaryDocumentUrl, retrievedAt: row.retrievedAt.toISOString() })),
        nextAfter: known.length > start + query.limit ? page.at(-1)!.id : null, freshness: await freshness(stock.id) };
    },
    async getFundamentals(symbol: string, query: SecQuery) {
      const stock = await instrument(symbol, query.exchange), cutoff = query.asOf ? new Date(query.asOf) : now();
      const all = stock.issuerId ? await db.companyFact.findMany({ where: { issuerId: stock.issuerId, periodEnd: { lte: cutoff }, filing: { filedDate: { lte: cutoff } } }, include: { filing: true }, take: 100001 }) : [];
      if (all.length > 100000) throw new HttpError(422, 'PROVIDER_NO_DATA', 'Fact history exceeds the local read bound.');
      const facts: FactObservation[] = all.filter((row) => filingAvailableAt(row.filing) <= cutoff).map((row) => ({
        id: row.id, taxonomy: row.taxonomy, concept: row.concept, unit: row.unit, value: row.value.toFixed(), periodStart: row.periodStart ? dateKey(row.periodStart) : null, periodEnd: dateKey(row.periodEnd),
        fiscalYear: row.fiscalYear, fiscalPeriod: row.fiscalPeriod, accessionNumber: row.filing.accessionNumber, filedDate: dateKey(row.filing.filedDate), acceptedAt: row.filing.acceptedAt?.toISOString() ?? null,
        availableAt: filingAvailableAt(row.filing).toISOString(), isAmendment: row.filing.isAmendment, retrievedAt: row.retrievedAt.toISOString(), sourceUrl: row.filing.primaryDocumentUrl,
        issuerTickerCount: Number((row.context as Record<string, unknown>).issuerTickerCount ?? 0),
      }));
      const close = await db.priceBar.findFirst({ where: { instrumentId: stock.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW',
        tradingDate: { lte: new Date(cutoff.getTime() - 29 * 3600000) } }, orderBy: { tradingDate: 'desc' } });
      let market: ValuationInput | undefined;
      if (close) {
        const annual = facts.filter((row) => row.periodStart && (Date.parse(row.periodEnd) - Date.parse(row.periodStart)) / 86400000 >= 329).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
        let verified = false;
        if (annual && close.currency === stock.currency) {
          const from = annual.periodEnd, through = dateKey(close.tradingDate);
          if (from <= through && Date.parse(through) - Date.parse(from) <= 450 * 86400000) {
            const bars = await db.priceBar.findMany({ where: { instrumentId: stock.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW', tradingDate: { gte: dateValue(from), lte: close.tradingDate } }, orderBy: { tradingDate: 'asc' } });
            try { verified = validateDailyCalendar(bars.map((row) => dateKey(row.tradingDate)), stock.exchange, from, through).fullRequestedRangeVerified
              && bars.length > 0 && bars.every((row) => row.splitFactor?.eq(1)); } catch { verified = false; }
          }
        }
        const latestState = await db.providerSyncState.findFirst({ where: { instrumentId: stock.id, provider: 'SEC_EDGAR', dataset: 'FUNDAMENTALS', scopeKey: 'COMPANYFACTS_V1' } });
        const tickerCount = Number((latestState?.cursor as Record<string, unknown> | null)?.issuerTickerCount ?? 0);
        market = { close: close.close.toFixed(), currency: close.currency, tradingDate: dateKey(close.tradingDate), provider: 'TIINGO', adjustmentMode: 'RAW', shareBasisVerified: verified,
          freshAtCutoff: cutoff.getTime() - close.tradingDate.getTime() <= 7 * 86400000, issuerTickerCount: tickerCount };
      }
      return { symbol: stock.symbol, cik: stock.issuer?.cik ?? null, asOf: cutoff.toISOString(), provider: 'SEC_EDGAR',
        ...analyzeFundamentals(facts, stock.currency, query.limit, market), freshness: await freshness(stock.id),
        limitations: ['US-GAAP standard entity-wide facts only; custom/IFRS/segment metrics are not inferred.', 'Period classification uses duration; fiscalYear/fiscalPeriod are filing hints, not calendar-quarter labels.',
          'YTD and standalone quarters remain separate; no automatic YTD subtraction or TTM calculation.', 'Later amendments are excluded by publication cutoff; SEC corrections to an original accession before first import cannot be reconstructed.',
          'Ambiguous same-accession values are unavailable. Missing acceptance timestamps use the following day at 05:00 UTC.', 'Valuation uses cached raw EOD prices and annual denominators; unsupported share basis, nonpositive earnings and missing same-date shares return null.'] };
    },
    async getStatus() {
      const job = await db.providerSyncJob.findFirst({ where: { provider: 'SEC_EDGAR' }, orderBy: { createdAt: 'desc' } });
      const recentSuccess = job?.status === 'SUCCEEDED' && job.finishedAt && now().getTime() - job.finishedAt.getTime() <= 24 * 3600000;
      return { provider: 'SEC_EDGAR', configured: provider.configured, status: !provider.configured ? 'Not Configured' : job?.errorCode === 'PROVIDER_RATE_LIMITED' ? 'Rate Limited' : job?.status === 'FAILED' ? 'Error' : recentSuccess ? 'Online' : 'Unknown',
        statusBasis: 'last explicit sync, possibly served from short-lived response cache; no live status probe',
        lastJob: job ? { id: job.id, status: job.status, errorCode: job.errorCode, finishedAt: job.finishedAt?.toISOString() ?? null, retryAfter: job.retryAfter?.toISOString() ?? null } : null,
        activeJobs: await db.providerSyncJob.count({ where: { provider: 'SEC_EDGAR', status: { in: ['QUEUED', 'RUNNING'] } } }) };
    },
    async waitForIdle() { await queue; },
    async stop() { stopping = true; provider.shutdown(); clearInterval(heartbeat); await queue; },
  };
}
export type SecService = ReturnType<typeof createSecService>;
