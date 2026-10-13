import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';
import { parseConfig } from '../dist/config/env.js';
import { ProviderError } from '../dist/providers/market-data.js';

test('Watchlist HTTP contracts require explicit protected writes, validate input and propagate meaningful provider failures', async t => {
  const config = parseConfig({}), calls = [];
  const id = '00000000-0000-4000-8000-000000000001';
  const service = {
    list: async query => { calls.push(['list', query]); return { items: [] }; },
    search: async query => { calls.push(['search', query]); if (query === 'limited') throw new ProviderError(429, 'PROVIDER_RATE_LIMITED', 'Safe cooldown.', new Date(Date.now() + 60000)); return { results: [] }; },
    resolve: async symbol => { calls.push(['resolve', symbol]); return { resolutionToken: id }; },
    add: async (token, sync) => { calls.push(['add', token, sync]); return { id }; },
    update: async (entry, input) => { calls.push(['update', entry, input]); return { id }; },
    remove: async entry => { calls.push(['remove', entry]); return { id, removed: true }; },
  };
  const server = createApp(config, { watchlist: service, logger: { info() {}, error() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method: options.method ?? 'GET', headers: { Host: '127.0.0.1:7001', ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}), ...options.headers } }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers })); }); req.on('error', reject); req.end(options.body);
  });
  const headers = { Origin: config.FRONTEND_ORIGIN, 'Content-Type': 'application/json', 'X-Stock-Research-Lab': '1' };
  const write = (path, body, method = 'POST') => request(path, { method, headers, body: JSON.stringify(body) });
  assert.equal((await request('/api/watchlist')).status, 200); assert.deepEqual(calls[0][1], { includeArchived: false, nearEntry: false, nearPercent: 5, sort: 'symbol', direction: 'asc' }); assert.equal(calls.length, 1);
  assert.equal((await request('/api/instruments/search')).status, 405); assert.equal((await request('/api/watchlist', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await write('/api/instruments/search', { query: 'company' })).status, 200);
  assert.equal((await write('/api/instruments/resolve', { symbol: 'test.a' })).status, 200); assert.equal(calls.at(-1)[1], 'TEST-A');
  assert.equal((await write('/api/watchlist', { resolutionToken: id })).status, 201);
  assert.equal((await write(`/api/watchlist/${id}`, { revision: 1, researchStatus: 'RESEARCHING', tags: ['Growth', 'growth'], notes: 'Private local note' }, 'PATCH')).status, 200); assert.deepEqual(calls.at(-1)[2].tags, ['growth']);
  assert.equal((await write(`/api/watchlist/${id}`, {}, 'DELETE')).status, 200);
  for (const body of [{}, { query: '' }, { query: 'x', apiKey: 'secret' }]) assert.equal((await write('/api/instruments/search', body)).status, 400);
  for (const body of [{ symbol: 'TEST', exchange: 'invented' }, { resolutionToken: id, initialSync: { startDate: '2026-02-30' } }, { resolutionToken: id, initialSync: { startDate: '2999-01-01' } }]) assert.equal((await write('/api/watchlist', body)).status, 400);
  for (const body of [{ notes: 'missing revision' }, { revision: 1 }, { revision: 1, researchStatus: 'TRADE' }, { revision: 1, tags: ['bad<tag'] }, { revision: 1, notes: '\u0000' }]) assert.equal((await write(`/api/watchlist/${id}`, body, 'PATCH')).status, 400);
  assert.equal((await request('/api/watchlist?nearEntry=yes')).status, 400); assert.equal((await request('/api/watchlist?nearPercent=51')).status, 400);
  const limited = await write('/api/instruments/search', { query: 'limited' }); assert.equal(limited.status, 429); assert.ok(limited.headers['retry-after']);
});
