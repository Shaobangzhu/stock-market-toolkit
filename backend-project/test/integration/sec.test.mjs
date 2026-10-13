import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { createSecService } from '../../dist/services/sec.js';
import { SecEdgarProvider } from '../../dist/providers/sec-edgar.js';
import { persistSecBundle, secAdmission } from '../../dist/repositories/sec.js';
import { createMarketDataService } from '../../dist/services/market-data.js';
import { mockSec, secConfig, acc, companyFacts } from '../fixtures/sec.mjs';

const url = new URL(process.env.DATABASE_URL);
assert.match(process.env.SRL_TEST_DATABASE ?? '', /^srl_test_[a-f0-9]{24}$/);
assert.equal(url.pathname, `/${process.env.SRL_TEST_DATABASE}`); assert.equal(url.hostname, '127.0.0.1');
const database = createDatabase({ DATABASE_URL: url.href }), db = database.client;
const now = () => new Date('2026-03-05T00:00:00Z');
const services = [];
after(() => database.close());
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  // Only the guarded runner-created disposable DB. Never personal application tables.
  for (const model of ['companyFact', 'secFiling', 'priceBar', 'providerSyncState', 'providerSyncJob', 'providerRequestUsage', 'instrument', 'issuer']) await db[model].deleteMany();
});
async function stock() { return db.instrument.create({ data: { symbol: 'TEST', exchange: 'NASDAQ', name: 'Test fixture', currency: 'USD', exchangeTimezone: 'America/New_York' } }); }
function service(mock = mockSec()) {
  const provider = new SecEdgarProvider(secConfig, { fetch: mock.fetch, sleep: async () => {}, now, admission: secAdmission(db, 2, now) });
  const service = createSecService(db, provider, now); services.push(service); return service;
}
const query = (extra = {}) => ({ limit: 40, ...extra });
test('SEC explicit sync persists filings/facts; reads and startup create no rows; duplicate sync is idempotent', async () => {
  const mock = mockSec(), s = service(mock);
  assert.equal((await s.getStatus()).status, 'Unknown'); assert.equal(mock.calls.length, 0);
  await assert.rejects(s.getFundamentals('TEST', query()), { status: 404 });
  await stock(); assert.deepEqual((await s.getFundamentals('TEST', query())).periods, []); assert.equal(mock.calls.length, 0);
  const [job, duplicate] = await Promise.all([s.requestSync('TEST', {}), s.requestSync('TEST', {})]); assert.equal(job.id, duplicate.id);
  await s.waitForIdle();
  assert.equal((await db.providerSyncJob.findUnique({ where: { id: job.id } })).status, 'SUCCEEDED');
  assert.equal(await db.issuer.count(), 1); assert.equal(await db.secFiling.count(), 6); assert.equal(await db.watchlistEntry.count(), 0);
  const count = await db.companyFact.count(); assert.ok(count > 0);
  const calls = mock.calls.length;
  assert.equal((await s.getFilings('TEST', query())).filings.length, 6); assert.equal((await s.getFundamentals('TEST', query())).provider, 'SEC_EDGAR'); assert.equal(mock.calls.length, calls);
  await s.requestSync('TEST', {}); await s.waitForIdle(); assert.equal(await db.companyFact.count(), count); assert.equal(await db.secFiling.count(), 6); assert.equal(mock.calls.length, calls);
  const cached = createDatabase({ DATABASE_URL: url.href });
  try { assert.equal(await cached.client.companyFact.count(), count); } finally { await cached.close(); }
  const marketService = createMarketDataService(db, { name: 'TIINGO', configured: false, shutdown() {} }, now);
  try { assert.equal((await marketService.getJob(job.id)).provider, 'SEC_EDGAR'); } finally { await marketService.stop(); }
});
test('SEC point-in-time reads exclude later filings and select amended facts without duplicated annual/YTD amounts', async () => {
  await stock(); const s = service(); await s.requestSync('TEST', {}); await s.waitForIdle();
  const before = await s.getFundamentals('TEST', query({ asOf: '2025-02-25T00:00:00Z' }));
  const annual = before.periods.find(p => p.periodKind === 'ANNUAL' && p.periodEnd === '2024-12-31');
  assert.equal(annual.metrics.revenue.value, '1000'); assert.equal(annual.metrics.netIncome.value, '100'); assert.equal(annual.metrics.freeCashFlow.value, '200');
  assert.ok(annual.metrics.revenue.sources.every(r => r.availableAt <= before.asOf));
  const after = await s.getFundamentals('TEST', query());
  assert.equal(after.periods.find(p => p.periodKind === 'ANNUAL').metrics.revenue.value, '1200');
  assert.equal(after.periods.find(p => p.periodKind === 'YTD').metrics.revenue.value, '700');
  assert.equal(after.periods.find(p => p.periodKind === 'QUARTER' && p.periodEnd === '2025-06-30').metrics.revenue.value, '400');
  const filings = await s.getFilings('TEST', query({ asOf: '2025-02-25T00:00:00Z', form: '10-K' }));
  assert.equal(filings.filings.length, 2); assert.ok(filings.filings.every(f => !f.isAmendment));
  const page = await s.getFilings('TEST', { limit: 1 }); assert.ok(page.nextAfter);
  assert.notEqual((await s.getFilings('TEST', { limit: 1, after: page.nextAfter })).filings[0].id, page.filings[0].id);
});
test('SEC failures and rate cooldown retain good facts and success metadata; missing contact prevents jobs', async () => {
  await stock(); const s = service(); await s.requestSync('TEST', {}); await s.waitForIdle(); const good = await db.companyFact.count();
  const failed = service(mockSec({ fetch: async () => new Response('not-logged', { status: 429, headers: { 'Retry-After': '120' } }) }));
  const job = await failed.requestSync('TEST', {}); await failed.waitForIdle();
  const stored = await db.providerSyncJob.findUnique({ where: { id: job.id } }); assert.equal(stored.status, 'FAILED'); assert.equal(stored.errorCode, 'PROVIDER_RATE_LIMITED');
  assert.equal(await db.companyFact.count(), good);
  const cache = await failed.getFundamentals('TEST', query()); assert.equal(cache.freshness.status, 'stale'); assert.ok(cache.freshness.lastSuccessAt);
  const budget = secAdmission(db, 2, now); await assert.rejects(budget.reserve(), { status: 429 });
  const missing = createSecService(db, new SecEdgarProvider({ SEC_EDGAR_MAX_RPS: 2 }), now); services.push(missing);
  const beforeJobs = await db.providerSyncJob.count(); await assert.rejects(missing.requestSync('TEST', {}), { status: 503 }); assert.equal(await db.providerSyncJob.count(), beforeJobs);
});
test('corrected same-accession facts retain immutable prior values and atomic failures roll back issuer/fact writes', async () => {
  const instrument = await stock(); const s = service(); await s.requestSync('TEST', {}); await s.waitForIdle();
  const input = companyFacts(); input.facts['us-gaap'].Revenues.units.USD.find(r => r.accn === acc.annual).val = 1001;
  const provider = new SecEdgarProvider(secConfig, { fetch: mockSec({ facts: input }).fetch, now, sleep: async () => {} });
  const bundle = await provider.retrieve('TEST', 'NASDAQ');
  await db.$transaction(tx => persistSecBundle(tx, instrument.id, bundle), { timeout: 60000 });
  const originalFiling = await db.secFiling.findUnique({ where: { accessionNumber: acc.annual } });
  const records = await db.companyFact.findMany({ where: { filingId: originalFiling.id, concept: 'Revenues' } });
  assert.deepEqual(records.map(r => r.value.toFixed()).sort(), ['1000', '1001']);
  assert.equal((await s.getFundamentals('TEST', query({ asOf: '2025-02-25T00:00:00Z' }))).periods.find(p => p.periodKind === 'ANNUAL').metrics.revenue.reason, 'AMBIGUOUS_DISCLOSURE');
  const before = await db.companyFact.count(); const broken = { ...bundle, facts: [...bundle.facts, { ...bundle.facts[0], contextHash: 'f'.repeat(64), value: '1e100' }] };
  await assert.rejects(db.$transaction(tx => persistSecBundle(tx, instrument.id, broken), { timeout: 60000 })); assert.equal(await db.companyFact.count(), before);
});
test('persisted SEC request admission spaces concurrent attempts and survives reconstruction', async () => {
  const admission = secAdmission(db, 2, now);
  const [a, b] = await Promise.all([admission.reserve(), admission.reserve()]);
  const rows = await db.providerRequestUsage.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { requestedAt: 'asc' } });
  assert.equal(rows[1].requestedAt.getTime() - rows[0].requestedAt.getTime(), 500);
  const third = await secAdmission(db, 2, now).reserve(); assert.equal(third.waitMs, 1000);
});

test('partial SEC fact responses fail atomically and preserve previously known facts and freshness', async () => {
  await stock(); const good = service(); await good.requestSync('TEST', {}); await good.waitForIdle();
  const count = await db.companyFact.count(); const incomplete = companyFacts(); delete incomplete.facts['us-gaap'].Revenues;
  const partial = service(mockSec({ facts: incomplete })); const job = await partial.requestSync('TEST', {}); await partial.waitForIdle();
  const saved = await db.providerSyncJob.findUnique({ where: { id: job.id } }); assert.equal(saved.status, 'FAILED'); assert.equal(saved.errorCode, 'PROVIDER_INVALID_RESPONSE');
  assert.equal(await db.companyFact.count(), count); assert.equal((await partial.getFundamentals('TEST', query())).freshness.status, 'stale');
});

test('SEC shutdown aborts pending requests and persists interruption without importing facts', { timeout: 5000 }, async () => {
  await stock(); let began;
  const started = new Promise(resolve => { began = resolve; });
  const s = service(mockSec({ fetch: async (_url, options) => {
    began(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true }));
  } }));
  const job = await s.requestSync('TEST', {}); await started; await s.stop();
  const saved = await db.providerSyncJob.findUnique({ where: { id: job.id } }); assert.equal(saved.status, 'INTERRUPTED');
  assert.equal(await db.companyFact.count(), 0); assert.equal(await db.issuer.count(), 0);
  await assert.rejects(s.requestSync('TEST', {}), { status: 503 });
});

test('abandoned SEC jobs are visible and recovered only by an explicit sync', async () => {
  const instrument = await stock();
  const orphan = await db.providerSyncJob.create({ data: { instrumentId: instrument.id, provider: 'SEC_EDGAR', dataset: 'FUNDAMENTALS', status: 'RUNNING', idempotencyKey: 'sec-orphan-test',
    requestSnapshot: {}, createdAt: new Date(now().getTime() - 10 * 60000), startedAt: new Date(now().getTime() - 9 * 60000), heartbeatAt: new Date(now().getTime() - 6 * 60000) } });
  const mock = mockSec(), s = service(mock); await s.getStatus(); assert.equal(mock.calls.length, 0); assert.equal((await db.providerSyncJob.findUnique({ where: { id: orphan.id } })).status, 'RUNNING');
  const next = await s.requestSync('TEST', {}); await s.waitForIdle(); assert.notEqual(next.id, orphan.id);
  assert.equal((await db.providerSyncJob.findUnique({ where: { id: orphan.id } })).status, 'INTERRUPTED'); assert.equal((await db.providerSyncJob.findUnique({ where: { id: next.id } })).status, 'SUCCEEDED');
});
