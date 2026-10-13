import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { after, afterEach, test } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { createWatchlistService } from '../../dist/services/watchlist.js';
import { createMarketDataService } from '../../dist/services/market-data.js';
import { ProviderError } from '../../dist/providers/market-data.js';
import { normalizePrices } from '../../dist/providers/tiingo-normalization.js';
import { observation } from '../fixtures/tiingo.mjs';

const url = new URL(process.env.DATABASE_URL);
assert.match(process.env.SRL_TEST_DATABASE ?? '', /^srl_test_[a-f0-9]{24}$/);
assert.equal(url.pathname, `/${process.env.SRL_TEST_DATABASE}`); assert.equal(url.hostname, '127.0.0.1');
const database = createDatabase({ DATABASE_URL: url.href }), db = database.client;
const now = () => new Date('2026-01-07T20:00:00Z');
after(() => database.close());
afterEach(async () => {
  // Guarded disposable test database only. No fixture ever enters the personal DB.
  // Completed versions intentionally reject DELETE. TRUNCATE is restricted by
  // the guards above to this run's disposable database and these fixture tables.
  await db.$executeRaw`TRUNCATE TABLE "EntryScenario", "ResearchSource", "ResearchNote", "ResearchRun", "PriceBar", "ProviderSyncState", "ProviderSyncJob", "ProviderRequestUsage", "WatchlistEntry", "WatchlistDetails", "Instrument"`;
});
const query = (extra = {}) => ({ includeArchived: false, nearEntry: false, nearPercent: 5, sort: 'symbol', direction: 'asc', ...extra });
function provider() {
  const calls = [];
  const metadata = symbol => ({ symbol, providerSymbol: symbol, exchange: 'NASDAQ', name: `Company ${symbol}`, currency: 'USD', exchangeTimezone: 'America/New_York', availableFrom: '2026-01-02', availableThrough: '2026-01-06' });
  const rows = symbol => ['2026-01-02', '2026-01-05', '2026-01-06'].map(day => observation(day, { close: symbol === 'PEER' ? '20' : '11', adjClose: symbol === 'PEER' ? '20' : '11', high: '22', adjHigh: '22' }));
  return { name: 'TIINGO', configured: true, calls, shutdown() {},
    searchInstruments: async term => { calls.push(['search', term]); return [{ symbol: 'TEST', name: 'Company TEST' }]; },
    resolveInstrument: async symbol => { calls.push(['resolve', symbol]); if (symbol === 'BAD') throw new ProviderError(404, 'INVALID_SYMBOL', 'Unsupported test symbol.'); return metadata(symbol); },
    getLatestEod: async symbol => normalizePrices([rows(symbol).at(-1)], now()),
    getDailyHistory: async (symbol, from, to) => normalizePrices(rows(symbol).filter(row => row.date.slice(0, 10) >= from && row.date.slice(0, 10) <= to), now()),
  };
}
function make(p = provider(), clock = now) {
  const market = createMarketDataService(db, p, clock);
  return { service: createWatchlistService(db, p, market, clock), market, provider: p };
}
async function add(service, symbol = 'TEST', initial) { const resolved = await service.resolve(symbol); return service.add(resolved.resolutionToken, initial); }

test('empty Watchlist reads and search/resolve never persist instruments, membership or provider jobs', async () => {
  const { service, market, provider } = make();
  try {
    const empty = await service.list(query()); assert.equal(empty.total, 0); assert.deepEqual(empty.items, []); assert.equal(provider.calls.length, 0);
    const found = await service.search('company'); assert.equal(found.results[0].symbol, 'TEST'); await service.search('company'); assert.equal(provider.calls.filter(c => c[0] === 'search').length, 1);
    const resolved = await service.resolve('TEST'); assert.equal(resolved.exchange, 'NASDAQ'); assert.equal(resolved.company, 'Company TEST');
    assert.equal(await db.instrument.count(), 0); assert.equal(await db.watchlistEntry.count(), 0); assert.equal(await db.providerSyncJob.count(), 0);
    await assert.rejects(service.resolve('BAD'), { status: 404 }); assert.equal(await db.instrument.count(), 0);
  } finally { await market.stop(); }
});
test('confirmed add prevents concurrent duplicates, defaults to Watching, creates no price/report data and survives reconnect', async () => {
  const { service, market } = make();
  try {
    const resolved = await service.resolve('TEST');
    const attempts = await Promise.allSettled([service.add(resolved.resolutionToken), service.add(resolved.resolutionToken)]);
    assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1); assert.equal(attempts.find(row => row.status === 'rejected').reason.code, 'WATCHLIST_DUPLICATE');
    assert.equal(await db.watchlistEntry.count(), 1); assert.equal(await db.priceBar.count(), 0); assert.equal(await db.researchRun.count(), 0); assert.equal(await db.providerSyncJob.count(), 0);
    assert.equal((await service.resolve('TEST')).alreadyAdded, true);
    const row = (await service.list(query())).items[0]; assert.equal(row.researchStatus, 'WATCHING'); assert.equal(row.lastPrice, null); assert.equal(row.fairValue, null); assert.equal(row.entryZone, null); assert.equal(row.latestResearch, null);
    const reconnected = createDatabase({ DATABASE_URL: url.href });
    try { const reopened = createWatchlistService(reconnected.client, provider(), { requestSync: async () => { throw Error('No implicit sync'); } }, now); assert.equal((await reopened.list(query())).total, 1); } finally { await reconnected.close(); }
  } finally { await market.stop(); }
});
test('research statuses, tags and notes persist with revision conflicts; membership removal retains metadata and research/price records', async () => {
  const { service, market } = make();
  try {
    const added = await add(service); let row = (await service.list(query())).items[0];
    await service.update(row.id, { revision: row.revision, researchStatus: 'RESEARCHING', tags: ['growth', 'long term'], notes: 'Personal thesis; no external transmission.' });
    await assert.rejects(service.update(row.id, { revision: row.revision, notes: 'Stale edit' }), { code: 'WATCHLIST_CONFLICT' });
    row = (await service.list(query())).items[0]; assert.equal(row.notes, 'Personal thesis; no external transmission.'); assert.equal(row.researchStatus, 'RESEARCHING');
    await service.update(row.id, { revision: row.revision, researchStatus: 'ARCHIVED' }); assert.equal((await service.list(query())).items.length, 0);
    assert.equal((await service.list(query({ status: 'ARCHIVED' }))).items.length, 1);
    await service.remove(added.id); assert.equal(await db.watchlistEntry.count(), 0); assert.equal(await db.instrument.count(), 1); assert.equal(await db.watchlistDetails.count(), 1);
    await add(service); row = (await service.list(query({ includeArchived: true }))).items[0]; assert.equal(row.notes, 'Personal thesis; no external transmission.'); assert.deepEqual(row.tags, ['growth', 'long term']); assert.equal(row.researchStatus, 'ARCHIVED');
  } finally { await market.stop(); }
});
test('optional historical import uses the existing durable runner; prices and sync status are real persisted observations', async () => {
  const { service, market } = make();
  try {
    const added = await add(service, 'TEST', { startDate: '2026-01-02' }); assert.ok(added.syncJob); await market.waitForIdle();
    const row = (await service.list(query())).items[0]; assert.equal(row.lastSyncJob.status, 'SUCCEEDED'); assert.equal(row.lastPrice.value, '11'); assert.equal(row.lastPrice.provider, 'TIINGO');
    assert.equal(row.dailyChange.percent, '0'); assert.equal(row.sparkline.length, 3); assert.equal(row.range52Week.coverage, 'partial'); assert.equal(row.fairValue, null); assert.equal(row.entryZone, null);
    const count = await db.priceBar.count(); await service.remove(added.id); assert.equal(await db.priceBar.count(), count);
  } finally { await market.stop(); }
});
test('provider failure after explicit optional sync does not undo successful membership or invent prices', async () => {
  const p = provider(); const service = createWatchlistService(db, p, { requestSync: async () => { throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'Test cooldown.'); } }, now);
  const added = await add(service, 'TEST', { startDate: '2026-01-02' }); assert.equal(added.syncError.code, 'PROVIDER_RATE_LIMITED'); assert.equal(added.syncJob, null);
  assert.equal((await service.list(query())).total, 1); assert.equal(await db.priceBar.count(), 0);
});
async function scenario(instrumentId, lower, upper) {
  return db.entryScenario.create({ data: { instrumentId, seriesId: randomUUID(), version: 1, method: 'test-only-saved-assumption', methodVersion: '1',
    inputSnapshot: {}, assumptions: { source: 'isolated-test-fixture' }, resultSnapshot: { watchlistProjection: { version: 1, adjustmentMode: 'RAW', referenceTradingDate: '2026-01-05', fairValueLow: '28', fairValueHigh: '35' } },
    currency: 'USD', lowerPrice: lower, upperPrice: upper, dataCutoff: new Date('2026-01-06T20:00:00Z'), createdAt: new Date('2026-01-07T19:00:00Z') } });
}
test('filtering and sorting use saved scenarios only, with exact distance, nulls last, real summaries and honest stale signals', async () => {
  const { service, market } = make();
  try {
    for (const symbol of ['TEST', 'PEER']) { await add(service, symbol, { startDate: '2026-01-02' }); await market.waitForIdle(); }
    await add(service, 'NONE'); const all = (await service.list(query())).items;
    for (const row of all.filter(row => row.symbol !== 'NONE')) await scenario(row.instrumentId, row.symbol === 'TEST' ? '10' : '15', row.symbol === 'TEST' ? '12' : '18');
    const testRow = all.find(row => row.symbol === 'TEST'); await service.update(testRow.id, { revision: 1, researchStatus: 'WAITING_FOR_ENTRY', tags: ['growth'] });
    const reportId = randomUUID(); await db.researchRun.create({ data: { id: reportId, instrumentId: testRow.instrumentId, seriesId: randomUUID(), version: 1, status: 'SUCCEEDED', idempotencyKey: randomUUID(), inputSnapshot: {}, inputHash: 'a'.repeat(64),
      dataCutoff: new Date('2026-01-06T00:00:00Z'), model: 'test-only', promptVersion: '1', outputSchemaVersion: '1', output: { summary: 'Test-only saved summary' }, createdAt: new Date('2026-01-07T18:00:00Z'), completedAt: new Date('2026-01-07T19:00:00Z') } });
    const ordered = await service.list(query({ sort: 'distance' })); assert.deepEqual(ordered.items.map(row => row.symbol), ['TEST', 'PEER', 'NONE']);
    assert.equal(ordered.items[0].distanceToEntry, '0'); assert.equal(ordered.items[0].fairValue.lower, '28'); assert.equal(ordered.items[0].latestResearch.summary, 'Test-only saved summary');
    assert.deepEqual((await service.list(query({ nearEntry: true }))).items.map(row => row.symbol), ['TEST']);
    assert.equal((await service.list(query({ search: 'Company PEER' }))).items[0].symbol, 'PEER'); assert.equal((await service.list(query({ tag: 'growth' }))).items[0].symbol, 'TEST');
    await db.providerSyncState.updateMany({ where: { instrumentId: testRow.instrumentId, scopeKey: 'DAY:RAW' }, data: { lastErrorCode: 'PROVIDER_UNAVAILABLE' } });
    assert.equal((await service.list(query({ nearEntry: true }))).items.length, 0);
    const reportCount = await db.researchRun.count(); await service.remove(testRow.id); assert.equal(await db.researchRun.count(), reportCount);
  } finally { await market.stop(); }
});
test('unverified adjustment/currency or changed split basis makes entry distance unavailable; identity confirmations expire', async () => {
  let time = now(); const { service, market } = make(provider(), () => time);
  try {
    const resolved = await service.resolve('TEST'); time = new Date(time.getTime() + 11 * 60000); await assert.rejects(service.add(resolved.resolutionToken), { code: 'RESOLUTION_EXPIRED' }); time = now();
    await add(service, 'TEST', { startDate: '2026-01-02' }); await market.waitForIdle(); const row = (await service.list(query())).items[0]; const saved = await scenario(row.instrumentId, '10', '12');
    await db.entryScenario.create({ data: { ...saved, id: randomUUID(), version: 2, currency: 'EUR', createdAt: new Date('2026-01-07T19:00:01Z') } }); assert.equal((await service.list(query())).items[0].distanceToEntry, null);
    await db.entryScenario.create({ data: { ...saved, id: randomUUID(), version: 3, currency: 'USD', createdAt: new Date('2026-01-07T19:00:02Z') } });
    await db.priceBar.updateMany({ where: { instrumentId: row.instrumentId, adjustmentMode: 'RAW', tradingDate: new Date('2026-01-06T00:00:00Z') }, data: { splitFactor: '2' } });
    const changed = (await service.list(query())).items[0]; assert.equal(changed.distanceToEntry, null); assert.equal(changed.dailyChange, null); assert.equal(changed.range52Week, null);
  } finally { await market.stop(); }
});

test('Watchlist and annotations survive a real backend-process restart without importing initial data', { timeout: 10000 }, async () => {
  const { service, market } = make();
  try {
    const added = await add(service); await service.update(added.id, { revision: 1, notes: 'Persisted across backend restarts', tags: ['retained'] });
    const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening'); const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const child = spawn(process.execPath, ['dist/index.js'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: url.href, TIINGO_API_KEY: '', OPENAI_API_KEY: '', SEC_EDGAR_USER_AGENT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = once(child, 'close');
    try {
      await new Promise((resolve, reject) => {
        const deadline = setTimeout(() => reject(Error('Temporary backend did not start')), 3000);
        child.stdout.on('data', chunk => { if (String(chunk).includes('server_started')) { clearTimeout(deadline); resolve(); } });
        child.once('error', error => { clearTimeout(deadline); reject(error); });
        child.once('exit', () => { clearTimeout(deadline); reject(Error('Temporary backend stopped before readiness')); });
      });
      const response = await fetch(`http://127.0.0.1:${port}/api/watchlist`); assert.equal(response.status, 200);
      const body = await response.json(); assert.equal(body.data.items[0].id, added.id); assert.equal(body.data.items[0].notes, 'Persisted across backend restarts'); assert.deepEqual(body.data.items[0].tags, ['retained']);
      assert.equal(await db.priceBar.count(), 0); assert.equal(await db.providerSyncJob.count(), 0); assert.equal(await db.providerRequestUsage.count(), 0);
    } finally { child.kill('SIGTERM'); await closed; }
  } finally { await market.stop(); }
});
