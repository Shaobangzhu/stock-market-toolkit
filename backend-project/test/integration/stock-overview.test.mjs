import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { createStockOverviewService } from '../../dist/services/stock-overview.js';
import { normalizePrices } from '../../dist/providers/tiingo-normalization.js';
import { upsertMarketPrices } from '../../dist/repositories/market-data.js';
import { observation } from '../fixtures/tiingo.mjs';

const url = new URL(process.env.DATABASE_URL);
assert.match(process.env.SRL_TEST_DATABASE ?? '', /^srl_test_[a-f0-9]{24}$/);
assert.equal(url.pathname, `/${process.env.SRL_TEST_DATABASE}`); assert.equal(url.hostname, '127.0.0.1');
const database = createDatabase({ DATABASE_URL: url.href }), db = database.client;
const now = () => new Date('2026-01-07T20:00:00Z'), service = createStockOverviewService(db, now);
after(() => database.close());
afterEach(async () => { await db.$executeRaw`TRUNCATE TABLE "EntryScenario", "ResearchSource", "ResearchNote", "ResearchRun", "PriceBar", "ProviderSyncState", "ProviderSyncJob", "ProviderRequestUsage", "WatchlistEntry", "WatchlistDetails", "Instrument"`; });
const identity = () => db.instrument.create({ data: { symbol: 'TEST', exchange: 'NASDAQ', name: 'Test Company', currency: 'USD', exchangeTimezone: 'America/New_York' } });
test('unknown/direct stock reads never create instruments, jobs, reports or memberships', async () => {
  await assert.rejects(service.getOverview('BAD', '1Y'), { status: 404 }); assert.equal(await db.instrument.count(), 0);
  const stock = await identity(); const data = await service.getOverview('TEST', 'MAX');
  assert.equal(data.inWatchlist, false); assert.equal(data.stock.instrumentId, stock.id); assert.equal(data.performance.observations, 0); assert.equal(data.company.description, null);
  assert.deepEqual(data.history, []); assert.equal(data.marginOfSafety, null); assert.equal(data.stock.entryZone, null);
  assert.equal(await db.watchlistEntry.count(), 0); assert.equal(await db.providerSyncJob.count(), 0); assert.equal(await db.researchRun.count(), 0);
});
test('real PostgreSQL Overview returns cached daily/adjusted history through failures, and survives removal of membership', async () => {
  const stock = await identity(); await db.watchlistEntry.create({ data: { instrumentId: stock.id } });
  const job = await db.providerSyncJob.create({ data: { instrumentId: stock.id, provider: 'TIINGO', dataset: 'PRICES', requestSnapshot: {}, idempotencyKey: randomUUID(), status: 'SUCCEEDED', createdAt: new Date('2026-01-07T19:00:00Z'), finishedAt: now() } });
  const rows = ['2026-01-02','2026-01-05','2026-01-06'].map((day, i) => observation(day, { close: String(10 + i), adjClose: String(5 + i / 2), high: '20', adjOpen: '5', adjLow: '4', adjHigh: '10' }));
  await db.$transaction(tx => upsertMarketPrices(tx, stock, job.id, normalizePrices(rows, now())));
  await db.providerSyncState.create({ data: { instrumentId: stock.id, provider: 'TIINGO', dataset: 'PRICES', scopeKey: 'DAY:RAW', lastSuccessAt: now(), lastErrorCode: 'PROVIDER_UNAVAILABLE', coverageStart: new Date('2026-01-02'), coverageEnd: new Date('2026-01-06') } });
  const data = await service.getOverview('TEST', 'MAX');
  assert.equal(data.stock.lastPrice.value, '12'); assert.equal(data.stock.dailyChange.value, '1'); assert.equal(data.stock.freshness, 'stale'); assert.equal(data.performance.adjustmentMode, 'TOTAL_RETURN'); assert.equal(data.performance.change.percent, '20');
  assert.equal(data.performance.averageVolume, '100'); assert.equal(data.inWatchlist, true);
  await db.watchlistEntry.delete({ where: { instrumentId: stock.id } });
  assert.equal((await service.getOverview('TEST', 'MAX')).inWatchlist, false); assert.equal(await db.priceBar.count(), 6);
});
test('history is stock-scoped, completed-only, publication-bounded and capped to five embedded records', async () => {
  const stock = await identity(), seriesId = randomUUID();
  const reports = [];
  for (let i = 1; i <= 7; i++) reports.push(await db.researchRun.create({ data: { instrumentId: stock.id, seriesId, version: i, status: 'SUCCEEDED', idempotencyKey: randomUUID(), inputSnapshot: {}, inputHash: 'a'.repeat(64), dataCutoff: new Date('2026-01-06'), model: 'test-only', promptVersion: '1', outputSchemaVersion: '1', output: { summary: `Test-only report ${i}` }, completedAt: new Date(`2026-01-07T19:00:0${i}Z`) } }));
  await db.entryScenario.create({ data: { instrumentId: stock.id, researchRunId: reports[0].id, seriesId: randomUUID(), version: 1, method: 'test-only-user-assumption', methodVersion: '1', inputSnapshot: {}, assumptions: {}, resultSnapshot: { watchlistProjection: { version: 1, adjustmentMode: 'RAW', referenceTradingDate: '2026-01-06', fairValueLow: '12', fairValueHigh: '14' } }, currency: 'USD', dataCutoff: new Date('2026-01-06'), createdAt: new Date('2026-01-07T19:01:00Z') } });
  await db.researchRun.create({ data: { instrumentId: stock.id, seriesId: randomUUID(), version: 1, status: 'FAILED', completedAt: now(), errorCode: 'TEST_FAILURE', idempotencyKey: randomUUID(), inputSnapshot: {}, inputHash: 'b'.repeat(64), dataCutoff: new Date('2026-01-06'), model: 'test-only', promptVersion: '1', outputSchemaVersion: '1' } });
  const data = await service.getOverview('TEST', '1Y'); assert.equal(data.history.length, 5); assert.equal(data.history[0].type, 'Entry Scenario'); assert.equal(data.history[1].version, 7);
  const history = await service.getHistory('TEST', 50); assert.equal(history.records.length, 8); assert.equal(history.records.at(-1).fairValue, null); assert.equal(history.records[0].fairValue.lower, '12');
  const peer = await db.instrument.create({ data: { symbol: 'PEER', exchange: 'NASDAQ', name: 'Other Test Company', currency: 'USD', exchangeTimezone: 'America/New_York' } });
  assert.equal((await service.getHistory(peer.symbol, 50)).records.length, 0);
  assert.equal(data.stock.latestResearch.summary, 'Test-only report 7');
});
test('qualitative panels expose only saved report points with owned citations; unsourced claims are withheld', async () => {
  const stock = await identity(), sourceId = randomUUID();
  const run = await db.researchRun.create({ data: { instrumentId: stock.id, seriesId: randomUUID(), version: 1, status: 'RUNNING', idempotencyKey: randomUUID(), inputSnapshot: {}, inputHash: 'a'.repeat(64), dataCutoff: new Date('2026-01-06'), model: 'test-only', promptVersion: '1', outputSchemaVersion: '1' } });
  await db.researchSource.create({ data: { id: sourceId, researchRunId: run.id, citationKey: 'news-1', url: 'https://example.com/isolated-test-news', title: 'Test-only saved headline', retrievedAt: now(), evidenceSnapshot: { sourceType: 'news' } } });
  await db.researchRun.update({ where: { id: run.id }, data: { status: 'SUCCEEDED', completedAt: now(), output: { summary: 'Test-only saved summary', overviewProjection: { version: 1,
    bullishDrivers: [{ text: 'Test-only cited driver', sourceIds: [sourceId] }], bearishRisks: [{ text: 'Unsourced test claim', sourceIds: [randomUUID()] }], catalysts: [] } } } });
  const data = await service.getOverview('TEST', 'MAX');
  assert.equal(data.news.headlines[0].title, 'Test-only saved headline'); assert.equal(data.news.bullishDrivers[0].sources[0].url, 'https://example.com/isolated-test-news');
  assert.deepEqual(data.news.bearishRisks, []); assert.equal(data.capabilities.aiResearch, false); assert.equal(await db.providerRequestUsage.count(), 0);
});
