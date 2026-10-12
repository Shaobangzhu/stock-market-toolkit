import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import { createDatabase } from '../../dist/services/database.js';
import { createMarketDataService } from '../../dist/services/market-data.js';
import { TiingoMarketDataProvider } from '../../dist/providers/tiingo.js';
import { normalizePrices } from '../../dist/providers/tiingo-normalization.js';
import { upsertMarketPrices } from '../../dist/repositories/market-data.js';
import { providerBudget } from '../../dist/repositories/provider-budget.js';
import { parseConfig } from '../../dist/config/env.js';
import { metadata, observation, jsonResponse } from '../fixtures/tiingo.mjs';

const url = new URL(process.env.DATABASE_URL);
assert.match(process.env.SRL_TEST_DATABASE ?? '', /^srl_test_[a-f0-9]{24}$/);
assert.equal(url.pathname, `/${process.env.SRL_TEST_DATABASE}`);
assert.equal(url.hostname, '127.0.0.1');
const database = createDatabase({ DATABASE_URL: url.href });
const db = database.client;
const now = () => new Date('2026-01-07T20:00:00Z');
const config = parseConfig({ NODE_ENV: 'test', TIINGO_API_KEY: 'synthetic-test-token' });
after(() => database.close());
afterEach(async () => {
  // Only the guarded runner's random disposable DB; never a personal database.
  for (const model of ['priceBar', 'providerSyncState', 'providerSyncJob', 'providerRequestUsage', 'instrument']) await db[model].deleteMany();
});
const query = (adjustment = 'RAW', extra = {}) => ({ adjustment, limit: 100, ...extra });

test('initial backfill, cached reads, idempotent refresh, increments and corporate-action rebasing persist exactly', async () => {
  let rows = [observation('2026-01-02'), observation('2026-01-05')];
  const calls = [];
  const mock = async (input) => {
    const request = new URL(input);
    calls.push(request.href);
    if (!request.pathname.endsWith('/prices')) return jsonResponse({ ...metadata, endDate: rows.at(-1).date.slice(0, 10) });
    const from = request.searchParams.get('startDate');
    const to = request.searchParams.get('endDate');
    return jsonResponse(from ? rows.filter((row) => row.date.slice(0, 10) >= from && row.date.slice(0, 10) <= to) : [rows.at(-1)]);
  };
  const service = createMarketDataService(db, new TiingoMarketDataProvider(config, providerBudget(db, config, now), { fetch: mock, now }), now);
  await assert.rejects(service.getPrices('TEST', query()), { status: 404 });
  assert.equal((await service.getStatus()).configured, true);
  assert.equal(calls.length, 0);
  assert.equal(await db.instrument.count(), 0);
  const [first, duplicate] = await Promise.all([service.requestSync('TEST', { startDate: '2026-01-02' }), service.requestSync('test', { startDate: '2026-01-02' })]);
  assert.equal(first.id, duplicate.id);
  await service.waitForIdle();
  assert.equal((await service.getJob(first.id)).status, 'SUCCEEDED');
  assert.equal(await db.instrument.count(), 1);
  assert.equal(await db.watchlistEntry.count(), 0);
  assert.equal(await db.priceBar.count(), 4);
  const beforeReads = calls.length;
  assert.equal((await service.getPrices('TEST', query())).bars.length, 2);
  assert.equal((await service.getPrices('TEST', query('TOTAL_RETURN'))).bars.length, 2);
  assert.equal(calls.length, beforeReads);
  const holiday = await service.getPrices('TEST', query('RAW', { from: '2026-01-03', to: '2026-01-04' }));
  assert.deepEqual(holiday.bars, []);
  assert.equal(holiday.freshness.calendarVerified, true);
  const page = await service.getPrices('TEST', query('RAW', { limit: 1 }));
  assert.equal(page.nextAfter, '2026-01-02');
  assert.equal((await service.getPrices('TEST', query('RAW', { after: page.nextAfter }))).bars[0].tradingDate, '2026-01-05');
  const second = await service.requestSync('TEST', {});
  await service.waitForIdle();
  assert.equal((await service.getJob(second.id)).status, 'SUCCEEDED');
  assert.equal(await db.priceBar.count(), 4);
  assert.ok((await db.priceBar.findMany()).every((row) => row.revision === 1));
  rows = rows.map((row) => ({ ...row, adjOpen: '9', adjHigh: '10.8', adjLow: '8.1', adjClose: '9.9' }));
  rows.push(observation('2026-01-06', { divCash: '1' }));
  const increment = await service.requestSync('TEST', {});
  await service.waitForIdle();
  const result = await service.getJob(increment.id);
  assert.equal(result.status, 'SUCCEEDED');
  assert.equal(result.result.rebased, true);
  assert.equal(await db.priceBar.count(), 6);
  const raw = await service.getPrices('TEST', query());
  const adjusted = await service.getPrices('TEST', query('TOTAL_RETURN'));
  assert.equal(raw.bars[0].close, '11');
  assert.equal(adjusted.bars[0].close, '9.9');
  assert.equal(raw.latestAvailableEod.dividendCash, '1');
  assert.equal(raw.freshness.currentAtLastSync, true);
  const reopened = createDatabase({ DATABASE_URL: url.href });
  try { assert.equal(await reopened.client.priceBar.count(), 6); } finally { await reopened.close(); }
});

test('incremental ranges use a bounded overlap, partial and rate-limited jobs preserve successful data and freshness', async () => {
  const instrument = await db.instrument.create({ data: { symbol: 'TEST', exchange: 'NASDAQ', name: 'Test', currency: 'USD', exchangeTimezone: 'America/New_York' } });
  let failing = false;
  let limited = false;
  const requests = [];
  const rows = [observation('2026-01-02'), observation('2026-01-05'), observation('2026-01-06')];
  const mock = async (input) => {
    const request = new URL(input);
    requests.push(request);
    if (limited) return jsonResponse({ detail: 'synthetic-test-token' }, 429, { 'Retry-After': '3600' });
    if (!request.pathname.endsWith('/prices')) return jsonResponse({ ...metadata, startDate: '2020-01-02', endDate: '2026-01-06' });
    if (!request.searchParams.has('startDate')) return jsonResponse([rows.at(-1)]);
    return jsonResponse(failing ? [rows[0], rows[2]] : rows);
  };
  const service = createMarketDataService(db, new TiingoMarketDataProvider(config, providerBudget(db, config, now), { fetch: mock, now }), now);
  const first = await service.requestSync('TEST', { startDate: '2026-01-02' });
  await service.waitForIdle();
  assert.equal((await service.getJob(first.id)).status, 'SUCCEEDED');
  const state = await service.getPrices('TEST', query());
  failing = true;
  const failed = await service.requestSync('TEST', {});
  await service.waitForIdle();
  assert.equal((await service.getJob(failed.id)).errorCode, 'PROVIDER_INVALID_RESPONSE');
  const afterFailure = await service.getPrices('TEST', query());
  assert.equal(afterFailure.bars.length, 3);
  assert.equal(afterFailure.freshness.lastSuccessAt, state.freshness.lastSuccessAt);
  assert.equal(afterFailure.freshness.consecutiveFailures, 1);
  assert.equal(requests.filter((request) => request.searchParams.has('startDate')).at(-1).searchParams.get('startDate'), '2025-12-30');
  limited = true;
  const throttled = await service.requestSync('TEST', {});
  await service.waitForIdle();
  assert.equal((await service.getJob(throttled.id)).errorCode, 'PROVIDER_RATE_LIMITED');
  assert.ok((await service.getJob(throttled.id)).retryAfter);
  assert.equal(await db.priceBar.count({ where: { instrumentId: instrument.id } }), 6);
  assert.equal((await service.getPrices('TEST', query())).freshness.consecutiveFailures, 2);
});

test('invalid symbols and unconfigured keys create no instruments, jobs, or watchlist membership', async () => {
  let count = 0;
  const invalid = createMarketDataService(db, new TiingoMarketDataProvider(config, providerBudget(db, config, now), { fetch: async () => { count++; return jsonResponse({}, 404); }, now }), now);
  await assert.rejects(invalid.requestSync('BAD', { fullHistory: true }), { code: 'INVALID_SYMBOL' });
  await assert.rejects(invalid.requestSync('../BAD', { fullHistory: true }), { code: 'INVALID_SYMBOL' });
  assert.equal(count, 1);
  assert.equal(await db.instrument.count(), 0);
  assert.equal(await db.providerSyncJob.count(), 0);
  const missing = createMarketDataService(db, new TiingoMarketDataProvider({}, providerBudget(db, config, now)), now);
  await assert.rejects(missing.requestSync('TEST', { fullHistory: true }), { code: 'PROVIDER_NOT_CONFIGURED' });
  assert.equal(await db.instrument.count(), 0);
});

test('persistent budgets serialize simultaneous requests, survive reconstruction, and track monthly symbols and bandwidth', async () => {
  const limitedConfig = { ...config, TIINGO_MAX_REQUESTS_PER_HOUR: 1 };
  const budget = providerBudget(db, limitedConfig, now);
  const results = await Promise.allSettled([budget.reserve('TEST', 100), budget.reserve('OTHER', 100)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'PROVIDER_RATE_LIMITED');
  await assert.rejects(providerBudget(db, limitedConfig, now).reserve('TEST', 100), { code: 'PROVIDER_RATE_LIMITED' });
  const usage = await db.providerRequestUsage.findFirst();
  await db.providerRequestUsage.update({ where: { id: usage.id }, data: { requestedAt: new Date('2026-01-01T00:00:00Z') } });
  const symbolBudget = providerBudget(db, { ...config, TIINGO_MAX_SYMBOLS_PER_MONTH: 1 }, now);
  await assert.rejects(symbolBudget.reserve('NEWTICKER', 100), { code: 'PROVIDER_RATE_LIMITED' });
  await db.providerRequestUsage.update({ where: { id: usage.id }, data: { responseBytes: 1000000000n } });
  await assert.rejects(providerBudget(db, config, now).reserve(usage.symbol, 1), { code: 'PROVIDER_RATE_LIMITED' });
});

test('bulk upsert rolls back every row on a constraint violation and active-job uniqueness prevents duplicate work', async () => {
  const instrument = await db.instrument.create({ data: { symbol: 'TEST', exchange: 'NASDAQ', name: 'Test', currency: 'USD', exchangeTimezone: 'America/New_York' } });
  const input = { instrumentId: instrument.id, provider: 'TIINGO', dataset: 'PRICES', requestSnapshot: {}, idempotencyKey: 'test-unique-1' };
  const job = await db.providerSyncJob.create({ data: input });
  await assert.rejects(db.providerSyncJob.create({ data: { ...input, idempotencyKey: 'test-unique-2' } }), { code: 'P2002' });
  const bars = normalizePrices([observation('2026-01-02'), observation('2026-01-05')], now());
  bars[2].high = '1';
  await assert.rejects(db.$transaction((tx) => upsertMarketPrices(tx, instrument, job.id, bars)));
  assert.equal(await db.priceBar.count(), 0);
});

test('graceful shutdown aborts in-flight requests and records an interrupted job without prices', async () => {
  await db.instrument.create({ data: { symbol: 'TEST', exchange: 'NASDAQ', name: 'Test', currency: 'USD', exchangeTimezone: 'America/New_York' } });
  let started;
  const inflight = new Promise((resolve) => { started = resolve; });
  const mock = async (input, { signal }) => {
    if (!new URL(input).pathname.endsWith('/prices')) return jsonResponse(metadata);
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('synthetic private request error')));
      started();
    });
  };
  const service = createMarketDataService(db, new TiingoMarketDataProvider(config, providerBudget(db, config, now), { fetch: mock, now }), now);
  const job = await service.requestSync('TEST', { startDate: '2026-01-02' });
  await inflight;
  await service.stop();
  const interrupted = await service.getJob(job.id);
  assert.equal(interrupted.status, 'INTERRUPTED');
  assert.equal(interrupted.errorCode, 'WORKER_INTERRUPTED');
  assert.equal(await db.priceBar.count(), 0);
  assert.equal(await db.providerRequestUsage.count(), 2);
});
