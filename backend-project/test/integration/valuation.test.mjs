import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, test } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { createValuationService, calculateSnapshot } from '../../dist/services/valuation.js';
import { createStockOverviewService } from '../../dist/services/stock-overview.js';

const url = new URL(process.env.DATABASE_URL);
assert.match(process.env.SRL_TEST_DATABASE ?? '', /^srl_test_[a-f0-9]{24}$/);
assert.equal(url.pathname, `/${process.env.SRL_TEST_DATABASE}`); assert.equal(url.hostname, '127.0.0.1');
const database = createDatabase({ DATABASE_URL: url.href }), db = database.client;
const cutoff = '2026-04-01T12:00:00.000Z', now = () => new Date(cutoff), service = createValuationService(db, now);
after(() => database.close());
// Immutable scenario triggers reject DELETE as intended. TRUNCATE only in this
// runner-created disposable database, after the destination guard above.
afterEach(async () => { await db.$executeRaw`TRUNCATE TABLE "EntryScenario", "CompanyFact", "SecFiling", "PriceBar", "ResearchSource", "ResearchNote", "ResearchRun", "WatchlistEntry", "WatchlistDetails", "ProviderSyncState", "ProviderSyncJob", "ProviderRequestUsage", "Instrument", "Issuer"`; });
function assumptions() {
  const c = { method: 'DIRECT', fairValue: '100', rationale: 'Isolated fixture only', entry: { mode: 'MARGIN', minimumSafety: '20', maximumSafety: '40' }, hypotheticalPrice: '70' };
  return { cutoff, exchange: 'NASDAQ', cases: { bear: { ...c, fairValue: '80' }, base: structuredClone(c), bull: { ...c, fairValue: '120' } } };
}
async function stock() {
  return db.instrument.create({ data: { symbol: 'TEST', exchange: 'NASDAQ', name: 'Test fixture', currency: 'USD', exchangeTimezone: 'America/New_York', createdAt: new Date('2026-01-01') } });
}
async function price(s) {
  return db.priceBar.create({ data: { instrumentId: s.id, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW', timestamp: new Date('2026-03-30'), tradingDate: new Date('2026-03-30'), currency: 'USD', exchangeTimezone: s.exchangeTimezone, open: '90', high: '90', low: '90', close: '90', volume: '1', retrievedAt: new Date('2026-03-31'), sourceHash: 'a'.repeat(64), splitFactor: '1' } });
}
test('cache-only sources/list/calculate remain read-only; saved decimal snapshots persist and replay after reconnect', async () => {
  await assert.rejects(service.sources('TEST', 'NASDAQ', cutoff), { status: 404 });
  assert.equal(await db.instrument.count(), 0);
  const s = await stock(); await price(s);
  const a = assumptions(), calculation = await service.calculate('TEST', a);
  assert.equal(calculation.result.cases[1].currentPriceMarginOfSafetyPercent, '10');
  assert.equal(await db.entryScenario.count(), 0); assert.deepEqual(await service.list('TEST', 'NASDAQ'), []);
  assert.equal(await db.providerSyncJob.count(), 0);
  const saved = await service.save('TEST', a, calculation.hash);
  assert.equal(saved.version, 1); const stored = await db.entryScenario.findUniqueOrThrow({ where: { id: saved.id } });
  assert.equal(stored.lowerPrice.toFixed(), '60'); assert.equal(stored.upperPrice.toFixed(), '80');
  const reconnect = createDatabase({ DATABASE_URL: url.href });
  try { const rows = await createValuationService(reconnect.client, now).list('TEST', 'NASDAQ'); assert.equal(rows[0].result.cases[1].fairValue, '100');
    const { hash: _hash, ...snapshot } = rows[0].inputSnapshot;
    assert.deepEqual(calculateSnapshot(rows[0].assumptions, snapshot).result, rows[0].result);
  } finally { await reconnect.close(); }
  const overview = await createStockOverviewService(db, now).getOverview('TEST', 'MAX');
  assert.equal(overview.stock.entryZone.lower, '60'); assert.equal(overview.stock.fairValue.upper, '120'); assert.equal(overview.marginOfSafety, '10');
});
test('edits create immutable versions and concurrent stale edits conflict', async () => {
  await stock(); const a = assumptions(), first = await service.calculate('TEST', a), saved = await service.save('TEST', a, first.hash);
  a.cases.base.fairValue = '110'; const second = await service.calculate('TEST', a);
  const writes = await Promise.allSettled([service.save('TEST', a, second.hash, saved.seriesId, 1), service.save('TEST', a, second.hash, saved.seriesId, 1)]);
  assert.equal(writes.filter(r => r.status === 'fulfilled').length, 1); assert.equal(writes.find(r => r.status === 'rejected').reason.status, 409);
  const rows = await service.list('TEST', 'NASDAQ'); assert.equal(rows.length, 2); assert.equal(rows.find(r => r.version === 1).result.cases[1].fairValue, '100');
  assert.equal(rows.find(r => r.version === 2).result.cases[1].fairValue, '110');
  await assert.rejects(service.save('TEST', a, second.hash, randomUUID(), 1), { status: 409 });
});
test('source revision between Calculate and Save is rejected; historical cutoff excludes later retrieval and future closes', async () => {
  const s = await stock(), bar = await price(s), a = assumptions(); const calculated = await service.calculate('TEST', a);
  await db.priceBar.update({ where: { id: bar.id }, data: { revision: 2, close: '91', high: '91' } });
  await assert.rejects(service.save('TEST', a, calculated.hash), { status: 409 }); assert.equal(await db.entryScenario.count(), 0);
  assert.equal((await service.sources('TEST', 'NASDAQ', '2026-03-30T12:00:00.000Z')).price, null);
  await assert.rejects(service.sources('TEST', 'NASDAQ', '2027-01-01T00:00:00.000Z'), { status: 400 });
});
test('SEC annual source selection excludes YTD, resolves amendments as known, rejects ambiguous corrections and missing data', async () => {
  const s = await stock(); const issuer = await db.issuer.create({ data: { cik: '0000000001', name: 'Fixture issuer' } });
  await db.instrument.update({ where: { id: s.id }, data: { issuerId: issuer.id } });
  async function fact(accession, filed, value, start = '2025-01-01') {
    const filing = await db.secFiling.create({ data: { issuerId: issuer.id, accessionNumber: accession, form: accession.endsWith('2') ? '10-K/A' : '10-K', filedDate: new Date(filed), acceptedAt: new Date(`${filed}T18:00:00Z`), primaryDocumentUrl: 'https://www.sec.gov/Archives/test-only', retrievedAt: new Date(`${filed}T19:00:00Z`) } });
    return db.companyFact.create({ data: { issuerId: issuer.id, filingId: filing.id, taxonomy: 'us-gaap', concept: 'EarningsPerShareDiluted', unit: 'USD/shares', value, periodStart: new Date(start), periodEnd: new Date('2025-12-31'), contextHash: randomUUID().replaceAll('-', '').padEnd(64, '0'), context: { issuerTickerCount: 1 }, retrievedAt: new Date(`${filed}T19:00:00Z`) } });
  }
  const old = await fact('0000000001-26-000001', '2026-02-01', '5');
  const newer = await fact('0000000001-26-000002', '2026-03-01', '6');
  await fact('0000000001-26-000003', '2026-02-02', '3', '2025-04-01');
  const historical = await service.sources('TEST', 'NASDAQ', '2026-02-15T12:00:00.000Z'); assert.deepEqual(historical.facts.map(f => f.id), [old.id]);
  const current = await service.sources('TEST', 'NASDAQ', cutoff); assert.deepEqual(current.facts.map(f => f.id), [newer.id]);
  const c = { method: 'PE', factId: newer.id, growthPercent: '0', horizonYears: 1, targetMultiple: '10', discountPercent: '0', shareBasisNote: 'User verifies share basis for isolated fixture', entry: { mode: 'MANUAL', lower: '40', upper: '50' }, hypotheticalPrice: null };
  const a = { cutoff, exchange: 'NASDAQ', cases: { bear: c, base: c, bull: c } };
  assert.equal((await service.calculate('TEST', a)).result.cases[1].fairValue, '60');
  a.cases = { bear: { ...c, factId: old.id }, base: c, bull: c }; await assert.rejects(service.calculate('TEST', a), { status: 422 });
  const { id, ...copy } = newer; await db.companyFact.create({ data: { ...copy, value: '7', contextHash: 'f'.repeat(64) } });
  assert.equal((await service.sources('TEST', 'NASDAQ', cutoff)).facts.length, 0);
});
