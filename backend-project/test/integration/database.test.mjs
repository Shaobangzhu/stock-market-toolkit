import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { instrumentRepository } from '../../dist/repositories/instruments.js';
import { priceRepository, serializePriceBar } from '../../dist/repositories/prices.js';

// Fail closed before constructing a client. Tests are launched by the guarded runner.
const url = new URL(process.env.DATABASE_URL);
assert.match(process.env.SRL_TEST_DATABASE ?? '', /^srl_test_[a-f0-9]{24}$/);
assert.equal(url.pathname, `/${process.env.SRL_TEST_DATABASE}`);
assert.equal(url.hostname, '127.0.0.1');
const database = createDatabase({ DATABASE_URL: url.href });
after(() => database.close());
const fixture = { symbol: 'SRL_TEST', exchange: 'XTEST', name: 'Test fixture', currency: 'USD', exchangeTimezone: 'America/New_York' };
const rollback = new Error('Test rollback');
const transactional = (fn) => database.client.$transaction(async (tx) => { await fn(tx); throw rollback; }, { timeout: 30_000 }).catch((error) => { if (error !== rollback) throw error; });
async function rejects(tx, action, code) {
  await tx.$executeRawUnsafe('SAVEPOINT expected_failure');
  let error;
  try { await action(); } catch (caught) { error = caught; }
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_failure');
  assert.ok(error, 'Expected database constraint to reject the write');
  if (code) assert.equal(error.code, code);
}
function bar(instrumentId, extra = {}) {
  return { instrumentId, provider: 'TIINGO', interval: 'DAY', adjustmentMode: 'RAW',
    timestamp: new Date('2026-01-02T00:00:00Z'), tradingDate: new Date('2026-01-02T00:00:00Z'),
    currency: 'USD', exchangeTimezone: 'America/New_York',
    open: '9007199254740993.12345678', high: '9007199254740994', low: '9007199254740992', close: '9007199254740993.12345678',
    volume: '9007199254740993', retrievedAt: new Date(), sourceHash: 'a'.repeat(64), ...extra };
}
function run(instrumentId, extra = {}) {
  return { instrumentId, seriesId: randomUUID(), version: 1, idempotencyKey: randomUUID(), inputSnapshot: { close: '0.10000001' },
    inputHash: 'b'.repeat(64), dataCutoff: new Date(), model: 'test-only', promptVersion: '1', outputSchemaVersion: '1', ...extra };
}

test('fresh migrations create exactly 14 empty application tables and constrained indexes', async () => {
  assert.equal(await database.ready(), true);
  const tables = await database.client.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  assert.equal(tables.length, 14);
  for (const { tablename } of tables) {
    const [{ count }] = await database.client.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${tablename}"`);
    assert.equal(count, 0, tablename);
  }
  const indexes = await database.client.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'`;
  for (const name of ['Instrument_symbol_exchange_key', 'PriceBar_series_timestamp_key', 'CompanyFact_context_key', 'ProviderSyncState_scope_key']) {
    assert.ok(indexes.some((index) => index.indexname === name && index.indexdef.includes('UNIQUE')), name);
  }
  const [{ unsafe }] = await database.client.$queryRaw`SELECT (rolsuper OR rolcreatedb OR rolcreaterole) AS unsafe FROM pg_roles WHERE rolname = current_user`;
  assert.equal(unsafe, false);
});

test('instrument identity, foreign keys and membership removal preserve stored data', () => transactional(async (tx) => {
  const repo = instrumentRepository(tx);
  const instrument = await repo.create(fixture);
  assert.equal((await repo.find('srl_test', 'xtest')).id, instrument.id);
  await rejects(tx, () => repo.create(fixture), 'P2002');
  await repo.create({ ...fixture, exchange: 'OTHER' });
  await repo.addToWatchlist(instrument.id);
  await rejects(tx, () => repo.addToWatchlist(instrument.id), 'P2002');
  await rejects(tx, () => repo.addToWatchlist(randomUUID()), 'P2003');
  await repo.removeFromWatchlist(instrument.id);
  assert.ok(await repo.find(fixture.symbol, fixture.exchange));
  await rejects(tx, () => tx.instrument.create({ data: { ...fixture, symbol: 'BADTZ', exchangeTimezone: 'Invalid/Zone' } }));
}));

test('price repositories persist exact decimals, constrain OHLCV/dates and separate series', () => transactional(async (tx) => {
  const instrument = await instrumentRepository(tx).create(fixture);
  const repo = priceRepository(tx);
  const input = bar(instrument.id);
  const saved = await repo.save(input);
  const serialized = serializePriceBar(saved);
  assert.equal(serialized.close, input.close);
  assert.equal(serialized.volume, input.volume);
  assert.equal(serialized.tradingDate, '2026-01-02');
  assert.equal((await repo.save({ ...input, close: '9007199254740993.2' })).revision, 2);
  await repo.save({ ...input, provider: 'TWELVE_DATA' });
  await repo.save({ ...input, adjustmentMode: 'SPLIT', volume: '100.125' });
  await rejects(tx, () => tx.priceBar.create({ data: { ...saved, id: randomUUID() } }), 'P2002');
  for (const change of [{ high: '1' }, { volume: '-1' }, { volume: '1.1' }, { timestamp: new Date('2026-01-02T01:00:00Z') }]) {
    await rejects(tx, () => repo.save({ ...input, ...change }));
  }
  assert.throws(() => repo.save({ ...input, close: 0.1 }), TypeError);
  assert.throws(() => repo.save({ ...input, close: '0.123456789' }), RangeError);
  await rejects(tx, () => tx.instrument.delete({ where: { id: instrument.id } }), 'P2003');
}));

test('SEC facts retain reporting periods, filing publication and issuer consistency', () => transactional(async (tx) => {
  const issuer = await tx.issuer.create({ data: { cik: '0000000001', name: 'Test issuer' } });
  const other = await tx.issuer.create({ data: { cik: '0000000002', name: 'Other test issuer' } });
  const filing = await tx.secFiling.create({ data: { issuerId: issuer.id, accessionNumber: '0000000001-26-000001', form: '10-K',
    filedDate: new Date('2026-02-01Z'), acceptedAt: new Date('2026-02-01T14:00:00-05:00'), reportPeriod: new Date('2025-12-31Z'),
    primaryDocumentUrl: 'https://www.sec.gov/test-only', retrievedAt: new Date() } });
  assert.equal(filing.acceptedAt.toISOString(), '2026-02-01T19:00:00.000Z');
  const data = { issuerId: issuer.id, filingId: filing.id, taxonomy: 'us-gaap', concept: 'TestConcept', unit: 'USD', value: '12345678901234567890.123456789012',
    periodStart: new Date('2025-01-01Z'), periodEnd: new Date('2025-12-31Z'), context: {}, contextHash: 'a'.repeat(64), retrievedAt: new Date() };
  assert.equal((await tx.companyFact.create({ data })).value.toFixed(), data.value);
  await rejects(tx, () => tx.companyFact.create({ data }), 'P2002');
  await rejects(tx, () => tx.companyFact.create({ data: { ...data, issuerId: other.id, contextHash: 'b'.repeat(64) } }), 'P2003');
  await rejects(tx, () => tx.companyFact.create({ data: { ...data, contextHash: 'c'.repeat(64), periodStart: new Date('2026-01-01Z') } }));
}));

test('research inputs, citations and completed versions are immutable; scenarios remain exact', () => transactional(async (tx) => {
  const instrument = await instrumentRepository(tx).create(fixture);
  const first = await tx.researchRun.create({ data: run(instrument.id) });
  const source = { researchRunId: first.id, citationKey: '1', url: 'https://example.org/test', title: 'Test citation', retrievedAt: new Date(), evidenceSnapshot: { quote: 'test-only' } };
  await tx.researchSource.create({ data: source });
  await rejects(tx, () => tx.researchRun.update({ where: { id: first.id }, data: { inputSnapshot: {} } }));
  await tx.researchRun.update({ where: { id: first.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), output: { text: 'test report' } } });
  await rejects(tx, () => tx.researchRun.update({ where: { id: first.id }, data: { output: {} } }));
  await rejects(tx, () => tx.researchSource.create({ data: { ...source, citationKey: '2' } }));
  await tx.researchRun.create({ data: run(instrument.id, { seriesId: first.seriesId, version: 2 }) });
  await rejects(tx, () => tx.researchRun.create({ data: run(instrument.id, { seriesId: first.seriesId }) }), 'P2002');
  const note = await tx.researchNote.create({ data: { instrumentId: instrument.id, researchRunId: first.id, seriesId: randomUUID(), version: 1, content: 'Test note' } });
  await rejects(tx, () => tx.researchNote.update({ where: { id: note.id }, data: { content: 'overwrite' } }));
  const scenario = await tx.entryScenario.create({ data: { instrumentId: instrument.id, researchRunId: first.id, seriesId: randomUUID(), version: 1,
    method: 'TEST_ONLY', methodVersion: '1', inputSnapshot: {}, assumptions: {}, resultSnapshot: {}, currency: 'USD', lowerPrice: '0.10000001', upperPrice: '0.2', dataCutoff: new Date() } });
  assert.equal(scenario.lowerPrice.toFixed(), '0.10000001');
  await rejects(tx, () => tx.entryScenario.update({ where: { id: scenario.id }, data: { lowerPrice: '0.15' } }));
  const other = await instrumentRepository(tx).create({ ...fixture, symbol: 'OTHER' });
  await rejects(tx, () => tx.researchNote.create({ data: { instrumentId: other.id, researchRunId: first.id, seriesId: randomUUID(), version: 1, content: 'Wrong stock' } }), 'P2003');
}));

test('sync failures preserve freshness and enforce idempotency and series scope', () => transactional(async (tx) => {
  const instrument = await instrumentRepository(tx).create(fixture);
  const job = { instrumentId: instrument.id, provider: 'TIINGO', dataset: 'PRICES', idempotencyKey: randomUUID(), requestSnapshot: { interval: 'DAY', adjustmentMode: 'RAW' } };
  const created = await tx.providerSyncJob.create({ data: job });
  await rejects(tx, () => tx.providerSyncJob.create({ data: job }), 'P2002');
  await tx.providerSyncJob.update({ where: { id: created.id }, data: { status: 'FAILED', errorCode: 'RATE_LIMITED', attempts: 1, finishedAt: new Date() } });
  const yesterday = new Date('2026-01-01Z');
  const state = { instrumentId: instrument.id, provider: 'TIINGO', dataset: 'PRICES', scopeKey: 'DAY:RAW', lastSuccessAt: yesterday };
  const saved = await tx.providerSyncState.create({ data: state });
  const failed = await tx.providerSyncState.update({ where: { id: saved.id }, data: { lastFailureAt: new Date(), consecutiveFailures: 1, lastErrorCode: 'RATE_LIMITED' } });
  assert.equal(failed.lastSuccessAt.toISOString(), yesterday.toISOString());
  await rejects(tx, () => tx.providerSyncState.create({ data: state }), 'P2002');
  await tx.providerSyncState.create({ data: { ...state, scopeKey: 'DAY:SPLIT' } });
}));
