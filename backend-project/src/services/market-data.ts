import { randomUUID } from 'node:crypto';
import type { PrismaClient, ProviderSyncJob } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { HttpError } from '../utils/http-error.js';
import { serializePriceBar } from '../repositories/prices.js';
import { upsertMarketPrices } from '../repositories/market-data.js';
import { canonicalSymbol, dateKey, dateValue, shiftDate, invalidPayload, ProviderError, type MarketDataProvider, type NormalizedInstrument, type NormalizedPrice } from '../providers/market-data.js';
import { validateDailyCalendar } from '../providers/us-daily-calendar.js';
import { logger } from '../utils/logger.js';
import { adjustmentBasisChanged } from '../providers/tiingo-normalization.js';

export interface SyncInput { startDate?: string; endDate?: string; fullHistory?: boolean; exchange?: string }
export interface PriceQuery { from?: string; to?: string; after?: string; exchange?: string; adjustment: 'RAW' | 'TOTAL_RETURN'; limit: number }
function serializeJob(job: ProviderSyncJob) {
  return { id: job.id, instrumentId: job.instrumentId, provider: job.provider, dataset: job.dataset,
    status: job.status, attempts: job.attempts, request: job.requestSnapshot, result: job.resultSnapshot,
    createdAt: job.createdAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null, errorCode: job.errorCode, retryAfter: job.retryAfter?.toISOString() ?? null };
}

export function createMarketDataService(db: PrismaClient, provider: MarketDataProvider, now = () => new Date()) {
  if (provider.name !== 'TIINGO') throw new HttpError(422, 'UNSUPPORTED_INSTRUMENT', 'These market-data endpoints use Tiingo only.');
  let queue: Promise<unknown> = Promise.resolve();
  let stopping = false;
  const running = new Set<string>();
  const admissions = new Map<string, Promise<ReturnType<typeof serializeJob>>>();
  async function findInstrument(symbol: string, exchange?: string) {
    const matches = await db.instrument.findMany({ where: { symbol: canonicalSymbol(symbol), ...(exchange ? { exchange } : {}) }, take: 2 });
    if (matches.length > 1) throw new HttpError(409, 'AMBIGUOUS_SYMBOL', 'Specify an exchange for this symbol.');
    return matches[0];
  }
  async function persistFailure(jobId: string, error: unknown) {
    const failure = error instanceof ProviderError ? error : new ProviderError(503, 'DATABASE_UNAVAILABLE', 'Synchronization failed. Check database availability.');
    await db.$transaction(async (tx) => {
      const code = stopping ? 'WORKER_INTERRUPTED' : failure.code;
      const job = await tx.providerSyncJob.update({ where: { id: jobId }, data: { status: stopping ? 'INTERRUPTED' : 'FAILED', finishedAt: now(), errorCode: code, retryAfter: failure.retryAfter ?? null } });
      for (const scopeKey of ['DAY:RAW', 'DAY:TOTAL_RETURN']) {
        const key = { instrumentId: job.instrumentId, provider: 'TIINGO' as const, dataset: 'PRICES' as const, scopeKey };
        await tx.providerSyncState.upsert({ where: { instrumentId_provider_dataset_scopeKey: key },
          create: { ...key, lastAttemptAt: now(), lastFailureAt: now(), lastErrorCode: code, consecutiveFailures: 1, nextEligibleAt: failure.retryAfter ?? null },
          update: { lastAttemptAt: now(), lastFailureAt: now(), lastErrorCode: code, consecutiveFailures: { increment: 1 }, nextEligibleAt: failure.retryAfter ?? null } });
      }
    });
  }
  async function execute(jobId: string, input: SyncInput, suppliedMetadata?: NormalizedInstrument) {
    await db.providerSyncJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: now(), heartbeatAt: now() } });
    const job = await db.providerSyncJob.findUniqueOrThrow({ where: { id: jobId }, include: { instrument: true } });
    const instrument = job.instrument;
    async function call<T>(fn: () => Promise<T>): Promise<T> {
      if (stopping) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'The market-data worker is stopping.');
      await db.providerSyncJob.update({ where: { id: jobId }, data: { attempts: { increment: 1 }, heartbeatAt: now() } });
      const result = await fn();
      await db.providerSyncJob.update({ where: { id: jobId }, data: { heartbeatAt: now() } });
      return result;
    }
    const metadata = suppliedMetadata ?? await call(() => provider.resolveInstrument(instrument.symbol));
    if (metadata.exchange !== instrument.exchange || metadata.currency !== instrument.currency || metadata.exchangeTimezone !== instrument.exchangeTimezone) {
      throw new ProviderError(409, 'SYNC_CONFLICT', 'Provider listing identity changed. Resolve the instrument identity before importing more data.');
    }
    const latest = await call(() => provider.getLatestEod(instrument.symbol));
    const latestRaw = latest.find((bar) => bar.adjustmentMode === 'RAW');
    if (!latestRaw || latestRaw.tradingDate < metadata.availableThrough || latestRaw.tradingDate > dateKey(now())) throw invalidPayload();
    const availableThrough = latestRaw.tradingDate;
    const existing = await db.priceBar.aggregate({ where: { instrumentId: instrument.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW' }, _min: { tradingDate: true }, _max: { tradingDate: true } });
    const previousStart = existing._min.tradingDate ? dateKey(existing._min.tradingDate) : undefined;
    const previousEnd = existing._max.tradingDate ? dateKey(existing._max.tradingDate) : undefined;
    if (previousEnd && previousEnd > availableThrough) throw invalidPayload();
    let from = input.fullHistory ? metadata.availableFrom : input.startDate ?? (previousEnd ? shiftDate(previousEnd, -7) : undefined);
    if (!from) throw new ProviderError(400, 'VALIDATION_ERROR', 'An initial sync requires startDate or fullHistory: true.');
    from = from < metadata.availableFrom ? metadata.availableFrom : from;
    let to = input.endDate && input.endDate < availableThrough ? input.endDate : availableThrough;
    if (from > to) throw new ProviderError(422, 'PROVIDER_NO_DATA', 'No Tiingo history is available in the requested date range.');
    async function history(start: string, end: string): Promise<NormalizedPrice[]> {
      if (dateValue(end).getTime() - dateValue(start).getTime() > 50 * 366 * 86400000) throw new ProviderError(400, 'VALIDATION_ERROR', 'A sync can cover at most 50 years. Choose an explicit start date.');
      const bars: NormalizedPrice[] = [];
      let cursor = start;
      while (cursor <= end) {
        const boundary = dateValue(cursor);
        boundary.setUTCFullYear(boundary.getUTCFullYear() + 5);
        // Non-overlapping five-year chunks bound payload/memory and request count.
        const chunkEnd = end < shiftDate(dateKey(boundary), -1) ? end : shiftDate(dateKey(boundary), -1);
        const part = await call(() => provider.getDailyHistory(instrument.symbol, cursor, chunkEnd));
        bars.push(...part);
        cursor = shiftDate(chunkEnd, 1);
      }
      const raw = bars.filter((bar) => bar.adjustmentMode === 'RAW');
      if (!raw.length || raw.length > 20000 || new Set(raw.map((bar) => bar.tradingDate)).size !== raw.length) throw invalidPayload();
      validateDailyCalendar(raw.map((bar) => bar.tradingDate), instrument.exchange, start, end);
      if (start <= availableThrough && end >= availableThrough && !raw.some((bar) => bar.tradingDate === availableThrough)) throw invalidPayload();
      if (start <= metadata.availableFrom && end >= metadata.availableFrom && !raw.some((bar) => bar.tradingDate === metadata.availableFrom)) throw invalidPayload();
      const adjusted = bars.filter((bar) => bar.adjustmentMode === 'TOTAL_RETURN');
      if (adjusted.length && adjusted.length !== raw.length) throw invalidPayload();
      const cached = await db.priceBar.findMany({ where: { instrumentId: instrument.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW', tradingDate: { gte: dateValue(start), lte: dateValue(end) } }, select: { tradingDate: true } });
      const returnedDates = new Set(raw.map((bar) => bar.tradingDate));
      if (cached.some((bar) => !returnedDates.has(dateKey(bar.tradingDate)))) throw invalidPayload();
      // Match history against the independently fetched latest EOD observation.
      if (end === availableThrough && raw.at(-1)?.sourceHash !== latestRaw!.sourceHash) throw invalidPayload();
      return bars;
    }
    let bars = await history(from, to);
    const cachedAdjusted = await db.priceBar.findMany({ where: { instrumentId: instrument.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'TOTAL_RETURN', tradingDate: { gte: dateValue(from), lte: dateValue(to) } } });
    const hasCachedAdjusted = await db.priceBar.count({ where: { instrumentId: instrument.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'TOTAL_RETURN' } }) > 0;
    const incomingAdjusted = bars.filter((bar) => bar.adjustmentMode === 'TOTAL_RETURN');
    if (hasCachedAdjusted && !incomingAdjusted.length) throw invalidPayload();
    let rebased = !!previousStart && !hasCachedAdjusted && incomingAdjusted.length > 0 && from > previousStart;
    const adjustedByDate = new Map(incomingAdjusted.map((bar) => [bar.tradingDate, bar]));
    for (const cached of cachedAdjusted) {
      const incoming = adjustedByDate.get(dateKey(cached.tradingDate));
      if (!incoming) throw invalidPayload();
      const old = cached.sourceData as Record<string, string> | null;
      if (!old || adjustmentBasisChanged(old, incoming.sourceData)) rebased = true;
    }
    if (hasCachedAdjusted && bars.some((bar) => bar.adjustmentMode === 'RAW' && (!previousEnd || bar.tradingDate > previousEnd)
      && ((bar.dividendCash !== null && bar.dividendCash !== '0') || (bar.splitFactor !== null && bar.splitFactor !== '1')))) rebased = true;
    if (rebased && previousStart) {
      from = previousStart < from ? previousStart : from;
      to = availableThrough;
      bars = await history(from, to);
    }
    const modes = [...new Set(bars.map((bar) => bar.adjustmentMode))];
    const result = { schemaVersion: 1, provider: 'TIINGO', interval: 'DAY', requestedFrom: from, requestedThrough: to,
      observations: bars.length, tradingDates: bars.filter((bar) => bar.adjustmentMode === 'RAW').length,
      adjustments: modes, rebased, availableThrough,
      calendarValidation: validateDailyCalendar(bars.filter((bar) => bar.adjustmentMode === 'RAW').map((bar) => bar.tradingDate), instrument.exchange, from, to) };
    if (stopping) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'The market-data worker is stopping.');
    await db.$transaction(async (tx) => {
      await upsertMarketPrices(tx, instrument, jobId, bars);
      for (const mode of modes) {
        const coverage = await tx.priceBar.aggregate({ where: { instrumentId: instrument.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: mode }, _min: { tradingDate: true }, _max: { tradingDate: true } });
        const key = { instrumentId: instrument.id, provider: 'TIINGO' as const, dataset: 'PRICES' as const, scopeKey: `DAY:${mode}` };
        const data = { lastAttemptAt: now(), lastSuccessAt: now(), lastErrorCode: null, consecutiveFailures: 0, nextEligibleAt: null,
          coverageStart: coverage._min.tradingDate, coverageEnd: coverage._max.tradingDate,
          freshThrough: coverage._max.tradingDate, cursor: { ...result, availableFrom: metadata.availableFrom } };
        await tx.providerSyncState.upsert({ where: { instrumentId_provider_dataset_scopeKey: key }, create: { ...key, ...data }, update: data });
      }
      await tx.instrument.update({ where: { id: instrument.id }, data: { name: metadata.name } });
      await tx.providerSyncJob.update({ where: { id: jobId }, data: { status: 'SUCCEEDED', finishedAt: now(), heartbeatAt: now(), resultSnapshot: result } });
    }, { timeout: 30000 });
  }

  return {
    async requestSync(symbolInput: string, input: SyncInput) {
      if (stopping) throw new ProviderError(503, 'PROVIDER_UNAVAILABLE', 'The market-data worker is stopping.');
      const symbol = canonicalSymbol(symbolInput);
      if (!provider.configured) throw new ProviderError(503, 'PROVIDER_NOT_CONFIGURED', 'Configure TIINGO_API_KEY in the backend environment file.');
      const admissionKey = `${symbol}:${input.exchange ?? ''}`;
      const pending = admissions.get(admissionKey);
      if (pending) return pending;
      const admit = (async () => {
        if (running.size >= 10) throw new HttpError(429, 'SYNC_BUSY', 'The local sync queue is full. Wait for an existing job to finish.');
        let instrument = await findInstrument(symbol, input.exchange);
        let metadata: NormalizedInstrument | undefined;
        if (!instrument) {
          if (!input.startDate && !input.fullHistory) throw new HttpError(400, 'VALIDATION_ERROR', 'An initial sync requires startDate or fullHistory: true.');
          metadata = await provider.resolveInstrument(symbol);
          if (input.exchange && input.exchange !== metadata.exchange) throw new HttpError(409, 'SYNC_CONFLICT', 'The requested exchange does not match Tiingo metadata.');
          instrument = await db.instrument.upsert({ where: { symbol_exchange: { symbol, exchange: metadata.exchange } },
            create: { symbol, exchange: metadata.exchange, name: metadata.name, currency: metadata.currency, exchangeTimezone: metadata.exchangeTimezone }, update: {} });
        }
        const admission = await db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(70011202)`;
          const active = await tx.providerSyncJob.findFirst({ where: { instrumentId: instrument!.id, provider: 'TIINGO', dataset: 'PRICES', status: { in: ['QUEUED', 'RUNNING'] } } });
          if (active) {
            // A new explicit action can recover a dead worker; never auto-replay jobs at startup.
            const heartbeat = active.heartbeatAt ?? active.createdAt;
            if (running.has(active.id) || now().getTime() - heartbeat.getTime() < 5 * 60000) return { job: active, owned: false };
            await tx.providerSyncJob.update({ where: { id: active.id }, data: { status: 'INTERRUPTED', finishedAt: now(), errorCode: 'WORKER_INTERRUPTED' } });
          }
          if (await tx.providerSyncJob.count({ where: { provider: 'TIINGO', dataset: 'PRICES', status: { in: ['QUEUED', 'RUNNING'] } } }) >= 10) {
            throw new HttpError(429, 'SYNC_BUSY', 'The local sync queue is full. Wait for an existing job to finish.');
          }
          const job = await tx.providerSyncJob.create({ data: { instrumentId: instrument!.id, provider: 'TIINGO', dataset: 'PRICES', idempotencyKey: randomUUID(), createdAt: now(), heartbeatAt: now(), requestSnapshot: { schemaVersion: 1, ...input, symbol, interval: 'DAY', adjustments: ['RAW', 'TOTAL_RETURN'] } } });
          return { job, owned: true };
        });
        const { job } = admission;
        if (admission.owned) {
          running.add(job.id);
          const heartbeat = setInterval(() => {
            void db.providerSyncJob.updateMany({ where: { id: job.id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { heartbeatAt: now() } }).catch(() => undefined);
          }, 30000).unref();
          queue = queue.then(() => execute(job.id, input, metadata)).catch(async (error: unknown) => {
            try { await persistFailure(job.id, error); } catch {
              logger.error({ event: 'sync_failure_persistence_failed', code: 'DATABASE_UNAVAILABLE' });
            }
          }).finally(() => { clearInterval(heartbeat); running.delete(job.id); });
        }
        return serializeJob(job);
      })();
      admissions.set(admissionKey, admit);
      try { return await admit; } finally { admissions.delete(admissionKey); }
    },
    async waitForIdle() { await queue; },
    async stop() { stopping = true; provider.shutdown?.(); await queue; },
    async getJob(id: string) {
      const job = await db.providerSyncJob.findUnique({ where: { id } });
      if (!job || !((job.provider === 'TIINGO' && job.dataset === 'PRICES') || (job.provider === 'SEC_EDGAR' && job.dataset === 'FUNDAMENTALS'))) throw new HttpError(404, 'NOT_FOUND', 'Sync job not found.');
      return serializeJob(job);
    },
    async getPrices(symbol: string, query: PriceQuery) {
      const instrument = await findInstrument(symbol, query.exchange);
      if (!instrument) throw new HttpError(404, 'NOT_FOUND', 'Stored instrument not found. Explicitly sync the stock first.');
      const series = { instrumentId: instrument.id, provider: 'TIINGO' as const, interval: 'DAY' as const, adjustmentMode: query.adjustment };
      const range: Prisma.DateTimeFilter = { ...(query.from ? { gte: dateValue(query.from) } : {}), ...(query.to ? { lte: dateValue(query.to) } : {}), ...(query.after ? { gt: dateValue(query.after) } : {}) };
      const [rows, latest, state] = await Promise.all([
        db.priceBar.findMany({ where: { ...series, tradingDate: range }, orderBy: { timestamp: 'asc' }, take: query.limit + 1 }),
        db.priceBar.findFirst({ where: series, orderBy: { timestamp: 'desc' } }),
        db.providerSyncState.findUnique({ where: { instrumentId_provider_dataset_scopeKey: { instrumentId: instrument.id, provider: 'TIINGO', dataset: 'PRICES', scopeKey: `DAY:${query.adjustment}` } } }),
      ]);
      const hasMore = rows.length > query.limit;
      const selected = rows.slice(0, query.limit);
      const cursor = state?.cursor as Record<string, unknown> | null;
      return { instrument: { id: instrument.id, symbol: instrument.symbol, exchange: instrument.exchange, name: instrument.name, currency: instrument.currency, exchangeTimezone: instrument.exchangeTimezone },
        provider: 'TIINGO', interval: 'DAY', adjustmentMode: query.adjustment,
        bars: selected.map(serializePriceBar), latestAvailableEod: latest ? serializePriceBar(latest) : null,
        nextAfter: hasMore ? dateKey(selected.at(-1)!.tradingDate) : null,
        freshness: { lastAttemptAt: state?.lastAttemptAt?.toISOString() ?? null, lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
          lastFailureAt: state?.lastFailureAt?.toISOString() ?? null, errorCode: state?.lastErrorCode ?? null, consecutiveFailures: state?.consecutiveFailures ?? 0,
          coverageStart: state?.coverageStart ? dateKey(state.coverageStart) : null, coverageEnd: state?.coverageEnd ? dateKey(state.coverageEnd) : null,
          providerAvailableThroughAtLastSync: cursor?.availableThrough ?? null,
          currentAtLastSync: !!latest && dateKey(latest.tradingDate) === cursor?.availableThrough,
          calendarCoverage: cursor?.calendarValidation ?? null,
          calendarVerified: !!state?.coverageStart && !!state.coverageEnd && state.coverageStart >= dateValue('2026-01-01')
            && state.coverageEnd <= dateValue('2026-12-31') && !!(cursor?.calendarValidation as { fullRequestedRangeVerified?: boolean } | undefined)?.fullRequestedRangeVerified,
          nextEligibleAt: state?.nextEligibleAt?.toISOString() ?? null } };
    },
    async getStatus() {
      const [last, lastJob] = await Promise.all([
        db.providerRequestUsage.findFirst({ where: { provider: 'TIINGO' }, orderBy: { requestedAt: 'desc' } }),
        db.providerSyncJob.findFirst({ where: { provider: 'TIINGO', dataset: 'PRICES' }, orderBy: { createdAt: 'desc' } }),
      ]);
      return { provider: 'TIINGO', configured: provider.configured, dataset: 'DAILY_EOD', lastRequestAt: last?.requestedAt.toISOString() ?? null,
        lastErrorCode: last?.errorCode ?? lastJob?.errorCode ?? null, retryAfter: last?.retryAfter?.toISOString() ?? lastJob?.retryAfter?.toISOString() ?? null,
        lastJob: lastJob ? serializeJob(lastJob) : null,
        activeJobs: await db.providerSyncJob.count({ where: { provider: 'TIINGO', dataset: 'PRICES', status: { in: ['RUNNING', 'QUEUED'] } } }) };
    },
  };
}
export type MarketDataService = ReturnType<typeof createMarketDataService>;
