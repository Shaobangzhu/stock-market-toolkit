import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';
import { parseConfig } from '../dist/config/env.js';

test('SEC GETs are cache reads; sync requires local write protection and all inputs are bounded', async t => {
  const config = parseConfig({}), calls = [];
  const service = {
    getFundamentals: async (symbol, query) => { calls.push(['read', symbol, query]); return { periods: [] }; },
    getFilings: async (symbol, query) => { calls.push(['filings', symbol, query]); return { filings: [] }; },
    requestSync: async (symbol, body) => { calls.push(['sync', symbol, body]); return { id: '00000000-0000-4000-8000-000000000001', status: 'QUEUED' }; },
    getStatus: async () => ({ configured: false, status: 'Not Configured' }),
  };
  const server = createApp(config, { sec: service, logger: { info() {}, error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = (path, options = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method: options.method ?? 'GET', headers: { Host: '127.0.0.1:7001', ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}), ...options.headers } }, res => {
      res.resume(); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location }));
    });
    req.on('error', reject); req.end(options.body);
  });
  assert.equal((await request('/api/stocks/test/fundamentals?asOf=2025-02-25T00%3A00%3A00Z')).status, 200);
  assert.equal((await request('/api/stocks/test/filings?form=10-K')).status, 200);
  assert.equal((await request('/api/providers/sec-edgar')).status, 200);
  assert.equal(calls.filter(c => c[0] === 'sync').length, 0);
  for (const path of ['/api/stocks/@bad/fundamentals', '/api/stocks/TEST/fundamentals?limit=41', '/api/stocks/TEST/fundamentals?asOf=2025-02-30', '/api/stocks/TEST/fundamentals?asOf=2999-01-01T00:00:00Z', '/api/stocks/TEST/filings?form=20-F', '/api/stocks/TEST/filings?after=oops', '/api/stocks/TEST/fundamentals?token=synthetic-secret']) assert.equal((await request(path)).status, 400);
  assert.equal((await request('/api/stocks/TEST/fundamentals/sync', { method: 'POST', body: '{}' })).status, 403);
  const headers = { Origin: config.FRONTEND_ORIGIN, 'Content-Type': 'application/json', 'X-Stock-Research-Lab': '1' };
  assert.equal((await request('/api/stocks/TEST/fundamentals/sync', { method: 'POST', headers, body: '{"exchange":"NASDAQ"}' })).status, 202);
  assert.equal((await request('/api/stocks/TEST/fundamentals/sync', { method: 'POST', headers, body: '{"apiKey":"synthetic-secret"}' })).status, 400);
  assert.equal((await request('/api/stocks/TEST/fundamentals/sync')).status, 405);
});
