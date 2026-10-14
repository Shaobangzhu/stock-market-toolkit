import type { Prisma } from '../generated/prisma/client.js';
import { canonicalSymbol, dateKey } from '../providers/market-data.js';
import { concepts, periodKind } from '../providers/sec-normalization.js';
import { filingAvailableAt } from '../services/sec.js';
import type { ValuationSnapshot, ValuationFact } from '../services/valuation-engine.js';
import { HttpError } from '../utils/http-error.js';

export async function valuationInstrument(tx: Prisma.TransactionClient, symbol: string, exchange: string) {
  const instrument = await tx.instrument.findUnique({ where: { symbol_exchange: { symbol: canonicalSymbol(symbol), exchange } } });
  if (!instrument) throw new HttpError(404, 'NOT_FOUND', 'Add this stock to local storage first.');
  return instrument;
}
export async function readValuationSnapshot(tx: Prisma.TransactionClient, symbol: string, exchange: string, cutoff: string): Promise<ValuationSnapshot> {
  const instrument = await valuationInstrument(tx, symbol, exchange), at = new Date(cutoff);
  const price = await tx.priceBar.findFirst({ where: { instrumentId: instrument.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW', currency: instrument.currency,
    exchangeTimezone: instrument.exchangeTimezone, retrievedAt: { lte: at }, tradingDate: { lte: new Date(at.getTime() - 29 * 3600000) } }, orderBy: { tradingDate: 'desc' } });
  const state = await tx.providerSyncState.findFirst({ where: { instrumentId: instrument.id, provider: 'TIINGO', dataset: 'PRICES', scopeKey: 'DAY:RAW' } });
  const rows = instrument.issuerId ? await tx.companyFact.findMany({ where: { issuerId: instrument.issuerId, taxonomy: 'us-gaap',
    concept: { in: [...concepts.eps, ...concepts.revenue] }, periodEnd: { lte: at, gte: new Date(at.getTime() - 550 * 86400000) }, retrievedAt: { lte: at },
    filing: { filedDate: { lte: at }, form: { in: ['10-K', '10-K/A', '10-Q', '10-Q/A'] } } }, include: { filing: true }, take: 10001 }) : [];
  if (rows.length > 10000) throw new HttpError(422, 'VALUATION_UNAVAILABLE', 'Annual fact history exceeds the valuation read bound.');
  const facts: ValuationFact[] = rows.filter(row => row.periodStart && periodKind(dateKey(row.periodStart), dateKey(row.periodEnd)) === 'ANNUAL'
    && row.periodEnd.getTime() - row.periodStart.getTime() <= 385 * 86400000 && filingAvailableAt(row.filing) <= at)
    .map(row => ({ id: row.id, metric: row.concept === 'EarningsPerShareDiluted' ? 'EPS' : 'REVENUE', value: row.value.toFixed(), unit: row.unit,
      periodStart: dateKey(row.periodStart!), periodEnd: dateKey(row.periodEnd), availableAt: filingAvailableAt(row.filing).toISOString(), retrievedAt: row.retrievedAt.toISOString(),
      accessionNumber: row.filing.accessionNumber, sourceUrl: row.filing.primaryDocumentUrl, concept: row.concept, issuerTickerCount: Number((row.context as Record<string, unknown>).issuerTickerCount ?? 0) }));
  // Keep latest disclosures per concept/unit/period. Ambiguous equal-publication values
  // are not offered; choosing an obsolete accession cannot bypass a known restatement.
  const selected = facts.filter(f => {
    const peers = facts.filter(p => p.concept === f.concept && p.unit === f.unit && p.periodStart === f.periodStart && p.periodEnd === f.periodEnd);
    return !peers.some(p => p.availableAt > f.availableAt) && new Set(peers.filter(p => p.availableAt === f.availableAt).map(p => p.value)).size === 1;
  }).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.id.localeCompare(b.id));
  return { instrument: { id: instrument.id, symbol: instrument.symbol, exchange: instrument.exchange, currency: instrument.currency }, cutoff,
    price: price ? { id: price.id, close: price.close.toFixed(), tradingDate: dateKey(price.tradingDate), retrievedAt: price.retrievedAt.toISOString(), revision: price.revision,
      sourceHash: price.sourceHash, provider: 'TIINGO', adjustmentMode: 'RAW', currency: price.currency,
      stale: at.getTime() - price.tradingDate.getTime() > 7 * 86400000 || !state?.lastSuccessAt || state.lastSuccessAt > at || at.getTime() - state.lastSuccessAt.getTime() > 86400000 || !!state.lastErrorCode } : null, facts: selected };
}
