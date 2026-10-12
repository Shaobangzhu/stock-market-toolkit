import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';
import { parseConfig } from '../dist/config/env.js';

test('market routes validate input, preserve local write protections, and perform no GET imports', async (t) => {
  const config = parseConfig({});
  const calls = [];
  const service = {
    getPrices: async (symbol, query) => { calls.push(['prices', symbol, query]); return { bars: [], provider: 'TIINGO' }; },
    requestSync: async (symbol, input) => { calls.push(['sync', symbol, input]); return { id: '00000000-0000-4000-8000-000000000001', status: 'QUEUED' }; },
    getStatus: async () => ({ configured: false }), getJob: async () => ({ status: 'SUCCEEDED' }),
  };
  const logs = [];
  const server = createApp(config, { marketData: service, logger: { error: (record) => logs.push(record), info() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method: options.method ?? 'GET',
      headers: { Host: '127.0.0.1:7001', ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}), ...options.headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: (name) => res.headers[name.toLowerCase()] } }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
  assert.equal((await request('/api/stocks/test.a/prices?adjustment=total-return')).status, 200);
  assert.equal(calls[0][1], 'TEST-A');
  assert.equal(calls[0][2].adjustment, 'TOTAL_RETURN');
  assert.equal(calls.some(([name]) => name === 'sync'), false);
  const headers = { Origin: config.FRONTEND_ORIGIN, 'Content-Type': 'application/json', 'X-Stock-Research-Lab': '1' };
  assert.equal((await request('/api/stocks/TEST/sync', { method: 'POST', body: '{}' })).status, 403);
  const valid = await request('/api/stocks/TEST/sync', { method: 'POST', headers, body: '{"startDate":"2026-01-02"}' });
  assert.equal(valid.status, 202);
  assert.match(valid.headers.get('location'), /^\/api\/sync-jobs\//);
  for (const path of ['/api/stocks/@bad/prices', '/api/stocks/TEST/prices?provider=twelve_data', '/api/stocks/TEST/prices?adjustment=split', '/api/stocks/TEST/prices?limit=5001', '/api/stocks/TEST/prices?from=2026-02-30', '/api/sync-jobs/not-a-uuid']) assert.equal((await request(path)).status, 400);
  for (const body of [{ startDate: '2026-02-30' }, { startDate: '2026-01-05', endDate: '2026-01-02' }, { startDate: '2026-01-02', fullHistory: true }, { token: 'synthetic-secret' }]) assert.equal((await request('/api/stocks/TEST/sync', { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  assert.equal((await request('/api/stocks/TEST/sync')).status, 405);
  assert.equal(JSON.stringify(logs).includes('synthetic-secret'), false);
});
