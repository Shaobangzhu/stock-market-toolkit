import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../utils/http-error.js';

const shape = { instrument: { include: {
  watchlistDetails: true,
  priceBars: { where: { provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW' }, orderBy: { tradingDate: 'desc' }, take: 270 },
  entryScenarios: { orderBy: [{ createdAt: 'desc' }, { version: 'desc' }, { id: 'desc' }], take: 5, include: { researchRun: { select: { status: true } } } },
  researchRuns: { where: { status: 'SUCCEEDED' }, orderBy: [{ completedAt: 'desc' }, { version: 'desc' }, { id: 'desc' }], take: 1 },
  syncStates: { where: { provider: 'TIINGO', dataset: 'PRICES', scopeKey: 'DAY:RAW' } },
  syncJobs: { where: { provider: 'TIINGO', dataset: 'PRICES' }, orderBy: { createdAt: 'desc' }, take: 1 },
} } } as const satisfies Prisma.WatchlistEntryInclude;
export type StoredWatchlistEntry = Prisma.WatchlistEntryGetPayload<{ include: typeof shape }>;

export async function readWatchlistEntries(db: PrismaClient): Promise<StoredWatchlistEntry[]> {
  return db.$transaction(async tx => {
    const entries = await tx.watchlistEntry.findMany({ include: { instrument: true }, orderBy: { addedAt: 'asc' }, take: 251 });
    if (entries.length > 250) throw new HttpError(422, 'WATCHLIST_LIMIT', 'Watchlist exceeds the workspace read bound.');
    const result: StoredWatchlistEntry[] = [];
    // Deliberately sequential on a transaction's single pg connection. Prisma's
    // multi-relation include issues concurrent queries, deprecated by pg 8.
    for (const entry of entries) {
      const instrumentId = entry.instrumentId;
      const watchlistDetails = await tx.watchlistDetails.findUnique({ where: { instrumentId } });
      const priceBars = await tx.priceBar.findMany({ ...shape.instrument.include.priceBars, where: { ...shape.instrument.include.priceBars.where, instrumentId } });
      const entryScenarios = await tx.entryScenario.findMany({ ...shape.instrument.include.entryScenarios, where: { instrumentId } });
      const researchRuns = await tx.researchRun.findMany({ ...shape.instrument.include.researchRuns, where: { ...shape.instrument.include.researchRuns.where, instrumentId } });
      const syncStates = await tx.providerSyncState.findMany({ where: { ...shape.instrument.include.syncStates.where, instrumentId } });
      const syncJobs = await tx.providerSyncJob.findMany({ ...shape.instrument.include.syncJobs, where: { ...shape.instrument.include.syncJobs.where, instrumentId } });
      result.push({ ...entry, instrument: { ...entry.instrument, watchlistDetails, priceBars, entryScenarios, researchRuns, syncStates, syncJobs } });
    }
    return result;
  }, { isolationLevel: 'RepeatableRead', timeout: 20000 });
}
