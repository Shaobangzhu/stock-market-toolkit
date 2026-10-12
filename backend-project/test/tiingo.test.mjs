import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalSymbol } from '../dist/providers/market-data.js';
import { normalizeInstrument, normalizePrices, parseProviderJson, adjustmentBasisChanged } from '../dist/providers/tiingo-normalization.js';
import { TiingoMarketDataProvider } from '../dist/providers/tiingo.js';
import { metadata, observation, jsonResponse } from './fixtures/tiingo.mjs';
import { validateDailyCalendar } from '../dist/providers/us-daily-calendar.js';

const now = () => new Date('2026-01-06T20:00:00Z');
function transport(fetch, options = {}) {
  const attempts = [];
  const budget = { reserve: async (symbol, bytes) => { attempts.push({ symbol, bytes }); return String(attempts.length); }, complete: async (id, bytes, errorCode, retryAfter) => Object.assign(attempts[Number(id) - 1], { bytes, errorCode, retryAfter }) };
  return { provider: new TiingoMarketDataProvider({ TIINGO_API_KEY: 'synthetic-test-token' }, budget, { fetch, now, sleep: async () => {}, ...options }), attempts };
}
test('normalizes metadata, share-class aliases, daily raw and split/dividend-adjusted bars', () => {
  assert.equal(canonicalSymbol('test.a'), 'TEST-A');
  const instrument = normalizeInstrument(metadata, 'test');
  assert.equal(instrument.currency, 'USD');
  assert.equal(instrument.exchangeTimezone, 'America/New_York');
  const bars = normalizePrices([observation('2026-01-05'), observation('2026-01-02', { adjClose: '10', divCash: '1', splitFactor: '2' })], now());
  assert.deepEqual(bars.map((bar) => `${bar.tradingDate}:${bar.adjustmentMode}`), ['2026-01-02:RAW', '2026-01-02:TOTAL_RETURN', '2026-01-05:RAW', '2026-01-05:TOTAL_RETURN']);
  assert.equal(bars[0].dividendCash, '1');
  assert.equal(bars[0].splitFactor, '2');
  assert.equal(bars[1].close, '10');
  assert.equal(bars[0].close, '11');
});
test('preserves JSON numeric lexemes beyond Number precision and records explicit rounding', () => {
  const input = JSON.stringify(observation('2026-01-02')).replace('"100"', '9007199254740993').replace('"10"', '10.1234567890123');
  const parsed = parseProviderJson(`[${input}]`);
  const [bar] = normalizePrices(parsed, now());
  assert.equal(bar.volume, '9007199254740993');
  assert.equal(bar.open, '10.12345679');
  assert.equal(bar.sourceData.open, '10.1234567890123');
  assert.throws(() => parseProviderJson('{"volume":NaN}'), { code: 'PROVIDER_INVALID_RESPONSE' });
});
test('adjustment-basis comparisons preserve changes beyond Decimal default division precision', () => {
  const source = { close: '9999999999999999.99999999', adjClose: '9999999999999999.99999998', volume: '100', adjVolume: '100' };
  assert.equal(adjustmentBasisChanged(source, { ...source }), false);
  assert.equal(adjustmentBasisChanged(source, { ...source, adjClose: '9999999999999999.99999997' }), true);
  assert.throws(() => normalizePrices([observation('2026-01-02', { volume: '1e-1000' })], now()), { code: 'PROVIDER_INVALID_RESPONSE' });
});
test('rejects inconsistent OHLC, missing values, duplicates, weekend bars, overflow and unexpected envelopes', () => {
  for (const patch of [{ high: '10' }, { low: '11.000000000001' }, { volume: '1.1' }, { close: null }, { open: 'NaN' }, { open: '1e1000' }, { adjOpen: null }, { splitFactor: '0' }, { divCash: '-1' }]) {
    assert.throws(() => normalizePrices([observation('2026-01-02', patch)], now()), { code: 'PROVIDER_INVALID_RESPONSE' });
  }
  assert.throws(() => normalizePrices([observation('2026-01-02'), observation('2026-01-02')], now()), { code: 'PROVIDER_INVALID_RESPONSE' });
  assert.throws(() => normalizePrices([observation('2026-01-03')], now()), { code: 'PROVIDER_INVALID_RESPONSE' });
  assert.throws(() => normalizePrices({ detail: 'synthetic-token' }, now()), { code: 'PROVIDER_INVALID_RESPONSE' });
  assert.throws(() => normalizePrices([observation('2026-01-05')], now(), { from: '2026-01-02', to: '2026-01-02' }), { code: 'PROVIDER_INVALID_RESPONSE' });
  assert.throws(() => normalizeInstrument({ ...metadata, ticker: 'OTHER' }, 'TEST'), { code: 'PROVIDER_INVALID_RESPONSE' });
  assert.throws(() => normalizeInstrument({ ...metadata, exchangeCode: 'FOREIGN' }, 'TEST'), { code: 'UNSUPPORTED_INSTRUMENT' });
  assert.throws(() => normalizeInstrument({ ...metadata, startDate: null }, 'TEST'), { code: 'PROVIDER_NO_DATA' });
  for (const value of ['../secret', '@bad', 'TEST?token=x']) assert.throws(() => canonicalSymbol(value), { code: 'INVALID_SYMBOL' });
});
test('holiday gaps and empty closed-day responses stay empty; missing adjusted fields do not become raw values', () => {
  const rawOnly = observation('2026-01-02');
  for (const key of ['adjOpen', 'adjHigh', 'adjLow', 'adjClose', 'adjVolume']) delete rawOnly[key];
  assert.equal(normalizePrices([rawOnly], now()).length, 1);
  assert.deepEqual(normalizePrices([], now()), []);
  assert.equal(normalizePrices([observation('2026-01-02'), observation('2026-01-05')], now()).length, 4);
});
test('exchange calendar allows holidays and early-close days but rejects missing known sessions', () => {
  const calendar = validateDailyCalendar(['2026-07-02', '2026-07-06'], 'NASDAQ', '2026-07-02', '2026-07-06');
  assert.equal(calendar.fullRequestedRangeVerified, true);
  assert.throws(() => validateDailyCalendar(['2026-07-02', '2026-07-03', '2026-07-06'], 'NYSE', '2026-07-02', '2026-07-06'), { code: 'PROVIDER_INVALID_RESPONSE' });
  assert.throws(() => validateDailyCalendar(['2026-01-02', '2026-01-06'], 'NYSE', '2026-01-02', '2026-01-06'), { code: 'PROVIDER_INVALID_RESPONSE' });
  assert.equal(validateDailyCalendar(['2026-11-27'], 'NYSE', '2026-11-27', '2026-11-27').fullRequestedRangeVerified, true);
  assert.equal(validateDailyCalendar(['2025-01-02'], 'NASDAQ', '2025-01-02', '2025-01-02').fullRequestedRangeVerified, false);
});
test('token is header-only, redirects are blocked and invalid credentials are not retried', async () => {
  let count = 0;
  const { provider } = transport(async (url, options) => {
    count++;
    assert.equal(url.origin, 'https://api.tiingo.com');
    assert.equal(url.href.includes('synthetic-test-token'), false);
    assert.equal(options.headers.Authorization, 'Token synthetic-test-token');
    assert.equal(options.redirect, 'error');
    return jsonResponse({ detail: 'synthetic-test-token' }, 401);
  });
  await assert.rejects(provider.resolveInstrument('TEST'), { code: 'PROVIDER_AUTH_FAILED' });
  await assert.rejects(provider.resolveInstrument('TEST'), { code: 'PROVIDER_AUTH_FAILED' });
  assert.equal(count, 1);
});
test('429 honors Retry-After and pauses subsequent requests without leaking error bodies', async () => {
  let count = 0;
  const { provider, attempts } = transport(async () => { count++; return jsonResponse({ detail: 'synthetic-test-token' }, 429, { 'Retry-After': '3600' }); });
  await assert.rejects(provider.getLatestEod('TEST'), (error) => error.code === 'PROVIDER_RATE_LIMITED' && error.retryAfter.toISOString() === '2026-01-06T21:00:00.000Z' && !error.message.includes('synthetic'));
  await assert.rejects(provider.getLatestEod('TEST'), { code: 'PROVIDER_RATE_LIMITED' });
  assert.equal(count, 1);
  assert.equal(attempts[0].errorCode, 'PROVIDER_RATE_LIMITED');
});
test('network errors and timeouts have exactly three bounded attempts; 404 is never retried', async () => {
  const unavailable = transport(async () => { throw new Error('Authorization: synthetic-test-token'); });
  await assert.rejects(unavailable.provider.getLatestEod('TEST'), (error) => error.code === 'PROVIDER_UNAVAILABLE' && !error.message.includes('synthetic'));
  assert.equal(unavailable.attempts.length, 3);
  const timeout = transport((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('synthetic')))), { timeoutMs: 5 });
  await assert.rejects(timeout.provider.getLatestEod('TEST'), { code: 'PROVIDER_UNAVAILABLE' });
  assert.equal(timeout.attempts.length, 3);
  const invalid = transport(async () => jsonResponse({ detail: 'synthetic' }, 404));
  await assert.rejects(invalid.provider.resolveInstrument('BAD'), { code: 'INVALID_SYMBOL' });
  assert.equal(invalid.attempts.length, 1);
});
test('successful retries normalize history; missing key prevents every request', async () => {
  let count = 0;
  const { provider } = transport(async () => ++count === 1 ? jsonResponse({}, 503) : jsonResponse([observation('2026-01-02')]));
  assert.equal((await provider.getDailyHistory('TEST', '2026-01-02', '2026-01-02')).length, 2);
  assert.equal(count, 2);
  const missing = new TiingoMarketDataProvider({}, { reserve: async () => { throw new Error('Must not reserve'); } });
  await assert.rejects(missing.getLatestEod('TEST'), { code: 'PROVIDER_NOT_CONFIGURED' });
});
