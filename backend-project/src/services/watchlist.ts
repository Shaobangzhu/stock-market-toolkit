import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { canonicalSymbol, dateKey, dateSchema, type MarketDataProvider, type NormalizedInstrument } from '../providers/market-data.js';
import { validateDailyCalendar } from '../providers/us-daily-calendar.js';
import type { MarketDataService, SyncInput } from './market-data.js';
import { HttpError } from '../utils/http-error.js';
import { readWatchlistEntries, type StoredWatchlistEntry } from '../repositories/watchlist.js';

export const researchStatus = z.enum(['WATCHING', 'RESEARCHING', 'WAITING_FOR_ENTRY', 'ARCHIVED']);
export const tagsSchema = z.array(z.string().trim().min(1).max(32).regex(/^[\p{L}\p{N} _-]+$/u).transform((value) => value.toLowerCase().replace(/ +/g, ' '))).max(10).transform((values) => [...new Set(values)]);
export interface WatchlistQuery { search?: string; status?: z.infer<typeof researchStatus>; tag?: string; includeArchived: boolean; nearEntry: boolean; nearPercent: number; sort: 'symbol' | 'company' | 'price' | 'distance' | 'status' | 'lastResearch' | 'lastUpdated'; direction: 'asc' | 'desc' }
export interface WatchlistUpdate { revision: number; researchStatus?: z.infer<typeof researchStatus>; tags?: string[]; notes?: string }
const Decimal = Prisma.Decimal.clone({ precision: 80 });
const decimalPrice = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/).refine((value) => new Decimal(value).gt(0) && new Decimal(value).lt('10000000000000000'));
// Read projection only. This does not create an entry-price method or analysis.
const projectionSchema = z.object({ version: z.literal(1), adjustmentMode: z.literal('RAW'), referenceTradingDate: dateSchema,
  fairValueLow: decimalPrice.optional(), fairValueHigh: decimalPrice.optional(),
});

export function projectWatchlistEntry(entry: StoredWatchlistEntry, now: Date) {
  const stock = entry.instrument, details = stock.watchlistDetails;
  const bars = stock.priceBars.filter((row) => row.currency === stock.currency && row.tradingDate <= now);
  const latest = bars[0], previous = bars[1], state = stock.syncStates[0];
  let dailyChange: { value: string; percent: string } | null = null;
  if (latest && previous && latest.splitFactor?.eq(1)) {
    try {
      const calendar = validateDailyCalendar([dateKey(previous.tradingDate), dateKey(latest.tradingDate)], stock.exchange, dateKey(previous.tradingDate), dateKey(latest.tradingDate));
      if (calendar.fullRequestedRangeVerified) dailyChange = { value: new Decimal(latest.close.toFixed()).minus(previous.close.toFixed()).toFixed(),
        percent: new Decimal(latest.close.toFixed()).div(previous.close.toFixed()).minus(1).mul(100).toDecimalPlaces(8).toFixed() };
    } catch { /* A missing session is not a one-day change. */ }
  }
  const start = latest ? new Date(latest.tradingDate.getTime() - 365 * 86400000) : null;
  const yearBars = start ? bars.filter((row) => row.tradingDate >= start) : [];
  const range = yearBars.length && yearBars.every((row) => row.splitFactor?.eq(1)) ? {
    low: Decimal.min(...yearBars.map((row) => row.low.toFixed())).toFixed(), high: Decimal.max(...yearBars.map((row) => row.high.toFixed())).toFixed(),
    through: dateKey(latest!.tradingDate), coverage: state?.coverageStart && start && state.coverageStart <= start ? 'stored-window' : 'partial', basis: 'TIINGO:DAY:RAW',
  } : null;
  const scenario = stock.entryScenarios.find((row) => row.createdAt <= now && row.dataCutoff <= now && (!row.researchRun || row.researchRun.status === 'SUCCEEDED'));
  const rawProjection = scenario?.resultSnapshot && typeof scenario.resultSnapshot === 'object' && !Array.isArray(scenario.resultSnapshot)
    ? (scenario.resultSnapshot as Record<string, unknown>).watchlistProjection : undefined;
  const projection = projectionSchema.safeParse(rawProjection);
  const basis = projection.success ? projection.data : undefined;
  const validZone = scenario?.lowerPrice && scenario.upperPrice && scenario.lowerPrice.gt(0) && scenario.lowerPrice.lte(scenario.upperPrice);
  const entryZone = validZone ? { lower: scenario!.lowerPrice!.toFixed(), upper: scenario!.upperPrice!.toFixed(), currency: scenario!.currency,
    scenarioId: scenario!.id, method: scenario!.method, savedAt: scenario!.createdAt.toISOString(), dataCutoff: scenario!.dataCutoff.toISOString(), basis: basis ? 'RAW' : 'unverified' } : null;
  const fairValue = scenario && basis?.fairValueLow && basis.fairValueHigh && new Decimal(basis.fairValueLow).lte(basis.fairValueHigh)
    ? { lower: basis.fairValueLow, upper: basis.fairValueHigh, currency: scenario.currency, scenarioId: scenario.id, savedAt: scenario.createdAt.toISOString() } : null;
  let distanceToEntry: string | null = null;
  if (entryZone && basis && latest && entryZone.currency === latest.currency && basis.referenceTradingDate <= dateKey(latest.tradingDate)) {
    const relevant = bars.filter((row) => dateKey(row.tradingDate) >= basis.referenceTradingDate);
    try {
      const complete = validateDailyCalendar(relevant.map((row) => dateKey(row.tradingDate)), stock.exchange, basis.referenceTradingDate, dateKey(latest.tradingDate));
      if (complete.fullRequestedRangeVerified && relevant.length && relevant.every((row) => row.splitFactor?.eq(1))) {
        const price = new Decimal(latest.close.toFixed());
        distanceToEntry = price.lt(entryZone.lower) ? price.div(entryZone.lower).minus(1).mul(100).toDecimalPlaces(8).toFixed()
          : price.gt(entryZone.upper) ? price.div(entryZone.upper).minus(1).mul(100).toDecimalPlaces(8).toFixed() : '0';
      }
    } catch { /* Unverified currency/share basis must not become an entry signal. */ }
  }
  const fresh = !!(latest && state?.lastSuccessAt && !state.lastErrorCode && now.getTime() - state.lastSuccessAt.getTime() <= 24 * 3600000 && now.getTime() - latest.tradingDate.getTime() <= 7 * 86400000);
  const report = stock.researchRuns.find((row) => row.completedAt && row.completedAt <= now);
  const summary = report?.output && typeof report.output === 'object' && !Array.isArray(report.output) ? (report.output as Record<string, unknown>).summary : undefined;
  const job = stock.syncJobs[0];
  const updated = [latest?.retrievedAt, report?.completedAt, details?.updatedAt, entry.addedAt].filter((value): value is Date => !!value).sort((a, b) => b.getTime() - a.getTime())[0]!;
  return { id: entry.id, instrumentId: stock.id, symbol: stock.symbol, company: stock.name, exchange: stock.exchange, currency: stock.currency,
    researchStatus: details?.researchStatus ?? 'WATCHING', tags: details?.tags ?? [], notes: details?.notes ?? '', revision: details?.revision ?? 0,
    addedAt: entry.addedAt.toISOString(), lastUpdatedAt: updated.toISOString(),
    lastPrice: latest ? { value: latest.close.toFixed(), tradingDate: dateKey(latest.tradingDate), retrievedAt: latest.retrievedAt.toISOString(), provider: 'TIINGO', adjustmentMode: 'RAW' } : null,
    dailyChange, range52Week: range, fairValue, entryZone, distanceToEntry, fresh,
    freshness: !latest ? 'unavailable' : fresh ? 'cached' : 'stale',
    sparkline: bars.slice(0, 60).reverse().map((row) => ({ tradingDate: dateKey(row.tradingDate), close: row.close.toFixed() })),
    latestResearch: report ? { id: report.id, completedAt: report.completedAt!.toISOString(), version: report.version, summary: typeof summary === 'string' ? summary.slice(0, 4000) : null } : null,
    lastSyncJob: job ? { id: job.id, status: job.status, errorCode: job.errorCode, retryAfter: job.retryAfter?.toISOString() ?? null } : null,
  };
}

export function createWatchlistService(db: PrismaClient, provider: MarketDataProvider, market: Pick<MarketDataService, 'requestSync'>, now = () => new Date()) {
  const resolutions = new Map<string, { identity: NormalizedInstrument; expires: number }>();
  const searchCache = new Map<string, { results: { symbol: string; name: string }[]; expires: number }>();
  const pending = new Map<string, Promise<{ symbol: string; name: string }[]>>();
  function prune() { for (const [key, row] of resolutions) if (row.expires <= now().getTime()) resolutions.delete(key); }
  return {
    async search(query: string) {
      const key = query.trim().toLowerCase();
      const stored = await db.instrument.findMany({ where: { OR: [{ symbol: { contains: query, mode: 'insensitive' } }, { name: { contains: query, mode: 'insensitive' } }] }, take: 20, orderBy: { symbol: 'asc' } });
      const local = stored.map((row) => ({ symbol: row.symbol, name: row.name }));
      const cached = searchCache.get(key);
      let remote: { symbol: string; name: string }[] = [];
      let warning: { code: string; message: string } | null = null;
      try {
        if (cached && cached.expires > now().getTime()) remote = cached.results;
        else {
          let promise = pending.get(key);
          if (!promise) {
            promise = (async () => {
              if (!provider.searchInstruments) throw new HttpError(503, 'PROVIDER_UNAVAILABLE', 'Company-name search is unavailable; enter an exact ticker to resolve it.');
              return provider.searchInstruments(query);
            })();
            pending.set(key, promise);
          }
          try { remote = await promise; } finally { pending.delete(key); }
          if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value!);
          searchCache.set(key, { results: remote, expires: now().getTime() + 10 * 60000 });
        }
      } catch (error) {
        if (!local.length) throw error;
        warning = { code: error instanceof HttpError ? error.code : 'PROVIDER_UNAVAILABLE', message: 'Provider search failed. Showing matching stored identities only.' };
      }
      const combined = new Map([...local, ...remote].map((row) => [row.symbol, row]));
      return { results: [...combined.values()].slice(0, 20), warning };
    },
    async resolve(symbol: string) {
      const canonical = canonicalSymbol(symbol);
      const stored = await db.instrument.findMany({ where: { symbol: canonical }, take: 2 });
      if (stored.length > 1) throw new HttpError(409, 'AMBIGUOUS_SYMBOL', 'Stored ticker matches multiple exchanges; resolve listing identity before adding.');
      const existing = stored[0];
      const identity: NormalizedInstrument = existing ? { ...existing, providerSymbol: existing.symbol, availableFrom: '', availableThrough: '' } : await provider.resolveInstrument(canonical);
      prune(); if (resolutions.size >= 100) resolutions.delete(resolutions.keys().next().value!);
      const resolutionToken = randomUUID(); resolutions.set(resolutionToken, { identity, expires: now().getTime() + 10 * 60000 });
      const member = existing ? await db.watchlistEntry.findUnique({ where: { instrumentId: existing.id } }) : null;
      return { resolutionToken, symbol: identity.symbol, company: identity.name, exchange: identity.exchange, currency: identity.currency, alreadyAdded: !!member, source: existing ? 'stored-identity' : 'TIINGO', expiresAt: new Date(now().getTime() + 10 * 60000).toISOString() };
    },
    async add(resolutionToken: string, initialSync?: SyncInput) {
      prune(); const resolved = resolutions.get(resolutionToken);
      if (!resolved) throw new HttpError(409, 'RESOLUTION_EXPIRED', 'Identity confirmation expired. Resolve the stock again before adding.');
      const identity = resolved.identity;
      const entry = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(70011205)`;
        const stock = await tx.instrument.upsert({ where: { symbol_exchange: { symbol: identity.symbol, exchange: identity.exchange } },
          create: { symbol: identity.symbol, exchange: identity.exchange, name: identity.name, currency: identity.currency, exchangeTimezone: identity.exchangeTimezone, createdAt: now(), updatedAt: now() }, update: {} });
        if (await tx.watchlistEntry.findUnique({ where: { instrumentId: stock.id } })) throw new HttpError(409, 'WATCHLIST_DUPLICATE', 'This listing is already in your Watchlist.');
        if (await tx.watchlistEntry.count() >= 250) throw new HttpError(422, 'WATCHLIST_LIMIT', 'This local workspace supports up to 250 Watchlist entries.');
        await tx.watchlistDetails.upsert({ where: { instrumentId: stock.id }, create: { instrumentId: stock.id, createdAt: now(), updatedAt: now() }, update: {} });
        return tx.watchlistEntry.create({ data: { instrumentId: stock.id, addedAt: now() } });
      });
      let syncJob: { id: string; status: string } | null = null;
      let syncError: { code: string; message: string } | null = null;
      if (initialSync) {
        try { const job = await market.requestSync(identity.symbol, { ...initialSync, exchange: identity.exchange }); syncJob = { id: job.id, status: job.status }; }
        catch (error) { syncError = { code: error instanceof HttpError ? error.code : 'DATABASE_UNAVAILABLE', message: 'Stock was added, but historical import could not start. Retry the import explicitly.' }; }
      }
      return { id: entry.id, symbol: identity.symbol, syncJob, syncError };
    },
    async list(query: WatchlistQuery) {
      const stored = await readWatchlistEntries(db);
      const rows = stored.map((row) => projectWatchlistEntry(row, now()));
      const near = (row: typeof rows[number]) => row.fresh && row.distanceToEntry !== null && new Decimal(row.distanceToEntry).abs().lte(query.nearPercent);
      const term = query.search?.trim().toLowerCase();
      const filtered = rows.filter((row) => (!term || `${row.symbol} ${row.company} ${row.tags.join(' ')}`.toLowerCase().includes(term))
        && (query.status ? row.researchStatus === query.status : query.includeArchived || row.researchStatus !== 'ARCHIVED')
        && (!query.tag || row.tags.includes(query.tag.toLowerCase())) && (!query.nearEntry || near(row)));
      filtered.sort((a, b) => {
        const get = (row: typeof a) => query.sort === 'distance' ? row.distanceToEntry : query.sort === 'price' ? row.lastPrice?.value ?? null
          : query.sort === 'lastResearch' ? row.latestResearch?.completedAt ?? null : query.sort === 'lastUpdated' ? row.lastUpdatedAt : query.sort === 'status' ? row.researchStatus : query.sort === 'company' ? row.company : row.symbol;
        const av = get(a), bv = get(b);
        if (av === null || bv === null) return av === bv ? a.symbol.localeCompare(b.symbol) : av === null ? 1 : -1;
        const value = query.sort === 'distance' ? new Decimal(av).abs().cmp(new Decimal(bv).abs()) : query.sort === 'price' ? a.currency.localeCompare(b.currency) || new Decimal(av).cmp(bv) : av.localeCompare(bv);
        return (query.direction === 'desc' ? -value : value) || a.symbol.localeCompare(b.symbol);
      });
      return { items: filtered, total: rows.length, filteredCount: filtered.length, availableTags: [...new Set(rows.flatMap((row) => row.tags))].sort(),
        summary: { tracked: rows.filter((row) => row.researchStatus !== 'ARCHIVED').length, archived: rows.filter((row) => row.researchStatus === 'ARCHIVED').length,
          nearEntry: rows.filter((row) => row.researchStatus !== 'ARCHIVED' && near(row)).length, researched: rows.filter((row) => !!row.latestResearch).length,
          priced: rows.filter((row) => !!row.lastPrice).length, fresh: rows.filter((row) => row.fresh).length }, asOf: now().toISOString() };
    },
    async update(id: string, input: WatchlistUpdate) {
      return db.$transaction(async (tx) => {
        const entry = await tx.watchlistEntry.findUnique({ where: { id } });
        if (!entry) throw new HttpError(404, 'NOT_FOUND', 'Watchlist entry no longer exists.');
        const updated = await tx.watchlistDetails.updateMany({ where: { instrumentId: entry.instrumentId, revision: input.revision },
          data: { ...(input.researchStatus ? { researchStatus: input.researchStatus } : {}), ...(input.tags ? { tags: input.tags } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), revision: { increment: 1 }, updatedAt: now() } });
        if (!updated.count) throw new HttpError(409, 'WATCHLIST_CONFLICT', 'Watchlist annotations changed. Refresh before saving again.');
        return { id, revision: input.revision + 1 };
      });
    },
    async remove(id: string) {
      const removed = await db.watchlistEntry.deleteMany({ where: { id } });
      if (!removed.count) throw new HttpError(404, 'NOT_FOUND', 'Watchlist entry no longer exists.');
      return { id, removed: true };
    },
  };
}
export type WatchlistService = ReturnType<typeof createWatchlistService>;
