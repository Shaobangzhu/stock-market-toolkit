import type { PrismaClient } from '../generated/prisma/client.js';
import { canonicalSymbol } from '../providers/market-data.js';
import { HttpError } from '../utils/http-error.js';

// One consistent cache snapshot; no provider, import or membership side effects.
export async function readStockOverview(db: PrismaClient, symbol: string, exchange: string | undefined, at: Date) {
  return db.$transaction(async tx => {
    const matches = await tx.instrument.findMany({ where: { symbol: canonicalSymbol(symbol), ...(exchange ? { exchange } : {}) }, take: 2 });
    if (!matches.length) throw new HttpError(404, 'NOT_FOUND', 'This stock is not stored locally. Add it from the Watchlist first.');
    if (matches.length > 1) throw new HttpError(409, 'AMBIGUOUS_SYMBOL', 'Specify the listing exchange.');
    const instrument = matches[0]!;
    const instrumentId = instrument.id;
    const issuer = instrument.issuerId ? await tx.issuer.findUnique({ where: { id: instrument.issuerId } }) : null;
    const membership = await tx.watchlistEntry.findUnique({ where: { instrumentId } });
    const watchlistDetails = await tx.watchlistDetails.findUnique({ where: { instrumentId } });
    const priceBars = await tx.priceBar.findMany({ where: { instrumentId, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW', currency: instrument.currency, tradingDate: { lte: at } }, orderBy: { tradingDate: 'desc' }, take: 20001 });
    const adjusted = await tx.priceBar.findMany({ where: { instrumentId, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'TOTAL_RETURN', currency: instrument.currency, tradingDate: { lte: at } }, orderBy: { tradingDate: 'desc' }, take: 20001 });
    if (priceBars.length > 20000 || adjusted.length > 20000) throw new HttpError(422, 'PROVIDER_NO_DATA', 'Stored history exceeds the Overview read bound.');
    const entryScenarios = await tx.entryScenario.findMany({ where: { instrumentId, createdAt: { lte: at }, dataCutoff: { lte: at } }, orderBy: [{ createdAt: 'desc' }, { version: 'desc' }, { id: 'desc' }], take: 5, include: { researchRun: { select: { status: true } } } });
    const researchRuns = await tx.researchRun.findMany({ where: { instrumentId, status: 'SUCCEEDED', completedAt: { lte: at }, dataCutoff: { lte: at } }, orderBy: [{ completedAt: 'desc' }, { version: 'desc' }, { id: 'desc' }], take: 50 });
    const reportScenarios = researchRuns.length ? await tx.entryScenario.findMany({ where: { instrumentId, researchRunId: { in: researchRuns.map(run => run.id) }, createdAt: { lte: at }, dataCutoff: { lte: at } }, orderBy: [{ createdAt: 'desc' }, { version: 'desc' }], take: 250 }) : [];
    const researchSources = researchRuns[0] ? await tx.researchSource.findMany({ where: { researchRunId: researchRuns[0].id }, orderBy: { citationKey: 'asc' }, take: 50 }) : [];
    const syncStates = await tx.providerSyncState.findMany({ where: { instrumentId, provider: 'TIINGO', dataset: 'PRICES', scopeKey: 'DAY:RAW' } });
    const syncJobs = await tx.providerSyncJob.findMany({ where: { instrumentId, provider: 'TIINGO', dataset: 'PRICES' }, orderBy: { createdAt: 'desc' }, take: 1 });
    return { instrument: { ...instrument, watchlistDetails, priceBars, entryScenarios, researchRuns, syncStates, syncJobs }, membership, issuer, adjusted, reportScenarios, researchSources };
  }, { isolationLevel: 'RepeatableRead', timeout: 20000 });
}
