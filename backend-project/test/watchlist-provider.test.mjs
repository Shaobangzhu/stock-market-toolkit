import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TiingoMarketDataProvider } from '../dist/providers/tiingo.js';
import { metadata } from './fixtures/tiingo.mjs';

test('Tiingo company-name search uses the same protected transport, ignores unsupported assets and validates beta responses', async () => {
  const calls = [], budget = { reserve: async () => 'mock-usage', complete: async () => {} };
  const provider = new TiingoMarketDataProvider({ TIINGO_API_KEY: 'synthetic-test-token' }, budget, { fetch: async (url, options) => {
    calls.push({ url, options }); return new Response(JSON.stringify([{ ticker: 'test.a', name: 'Test Company', assetType: 'Stock', isActive: true }, { ticker: 'fund', name: 'Test Fund', assetType: 'ETF', isActive: true }, { ticker: 'old', name: 'Inactive', assetType: 'Stock', isActive: false }]), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.deepEqual(await provider.searchInstruments('Test Company'), [{ symbol: 'TEST-A', name: 'Test Company' }]);
  const request = calls[0]; assert.equal(request.url.pathname, '/tiingo/utilities/search'); assert.equal(request.url.searchParams.get('query'), 'Test Company'); assert.ok(!request.url.href.includes('synthetic-test-token')); assert.equal(request.options.headers.Authorization, 'Token synthetic-test-token');
  const invalid = new TiingoMarketDataProvider({ TIINGO_API_KEY: 'synthetic-test-token' }, budget, { fetch: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(invalid.searchInstruments('Test'), { status: 502 });
});

test('Tiingo beta-search permission rejection does not disable valid daily metadata/history access', async () => {
  const calls = [];
  const provider = new TiingoMarketDataProvider({ TIINGO_API_KEY: 'synthetic-test-token' }, { reserve: async () => 'mock-usage', complete: async () => {} }, { fetch: async url => {
    calls.push(url.pathname); return url.pathname.includes('/utilities/search') ? new Response('{}', { status: 403, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(metadata), { headers: { 'Content-Type': 'application/json' } });
  } });
  await assert.rejects(provider.searchInstruments('Test'), { status: 503 });
  await assert.rejects(provider.searchInstruments('Test'), { status: 503 });
  assert.equal((await provider.resolveInstrument('TEST')).symbol, 'TEST');
  assert.deepEqual(calls, ['/tiingo/utilities/search', '/tiingo/daily/TEST']);
});
