import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../dist/app.js';
import { parseConfig } from '../dist/config/env.js';
import { Prisma } from '../dist/generated/prisma/client.js';
import { pricePerformance, rangeStart } from '../dist/services/stock-overview.js';
import { HttpError } from '../dist/utils/http-error.js';

const decimal = value => new Prisma.Decimal(value);
function bar(day, close, mode = 'RAW') { return { tradingDate: new Date(`${day}T00:00:00Z`), close: decimal(close), volume: decimal('1000'), splitFactor: decimal('1'), adjustmentMode: mode }; }
test('Overview windows clamp month ends and MAX means all stored history', () => {
  assert.equal(rangeStart('2026-03-31', '1M'), '2026-02-28');
  assert.equal(rangeStart('2024-02-29', '1Y'), '2023-02-28');
  assert.equal(rangeStart('2026-01-07', 'MAX'), null);
});
test('performance keeps adjusted and raw observations separate and computes exact observed-endpoint changes', () => {
  const raw = [bar('2026-01-06', '110'), bar('2026-01-05', '100'), bar('2026-01-02', '100')];
  const adjusted = [bar('2026-01-06', '55', 'TOTAL_RETURN'), bar('2026-01-05', '50', 'TOTAL_RETURN'), bar('2026-01-02', '50', 'TOTAL_RETURN')];
  const p = pricePerformance(raw, adjusted, 'NASDAQ', 'MAX');
  assert.equal(p.adjustmentMode, 'TOTAL_RETURN'); assert.equal(p.change.percent, '10'); assert.equal(p.change.value, '5'); assert.equal(p.averageVolume, '1000');
  const incomplete = pricePerformance(raw, adjusted.slice(0, 2), 'NASDAQ', 'MAX');
  assert.equal(incomplete.adjustmentMode, 'RAW'); assert.equal(incomplete.change.value, '10'); assert.equal(incomplete.points[0].close, '100');
  raw[0].splitFactor = null; assert.equal(pricePerformance(raw, [], 'NASDAQ', 'MAX').change, null);
});
test('missing sessions break the chart and withhold daily volatility; partial short histories remain explicit', () => {
  const p = pricePerformance([bar('2026-01-06', '110'), bar('2026-01-02', '100')], [], 'NASDAQ', '1Y');
  assert.equal(p.calendarVerified, false); assert.equal(p.coverage, 'partial-or-unverified'); assert.equal(p.change, null); assert.equal(p.volatility, null);
  assert.equal(p.points[1].close, null);
  assert.equal(pricePerformance([], [], 'NASDAQ', 'MAX').coverage, 'unavailable');
});
test('historical volatility agrees with a hand-checkable balanced 20-return sample and requires 20 returns', () => {
  const dates = ['2026-01-02','2026-01-05','2026-01-06','2026-01-07','2026-01-08','2026-01-09','2026-01-12','2026-01-13','2026-01-14','2026-01-15','2026-01-16','2026-01-20','2026-01-21','2026-01-22','2026-01-23','2026-01-26','2026-01-27','2026-01-28','2026-01-29','2026-01-30','2026-02-02'];
  // 10 returns +ln(1.01), 10 returns -ln(1.01), mean zero;
  // variance = 20/19 * ln(1.01)^2; annualized result 16.2060057711%.
  const rows = dates.map((day, i) => bar(day, i % 2 ? '101' : '100')).reverse();
  const p = pricePerformance(rows, [], 'NASDAQ', 'MAX');
  assert.equal(p.volatility, '16.206006'); assert.equal(p.change.percent, '0');
  assert.equal(pricePerformance(rows.slice(1), [], 'NASDAQ', 'MAX').volatility, null);
});
test('Overview HTTP reads validate ranges/limits/symbols, surface 404/503 and never admit sync jobs', async t => {
  const calls = [];
  const service = { getOverview: async (...args) => { calls.push(args); if (args[0] === 'BAD') throw new HttpError(404, 'NOT_FOUND', 'Stored stock missing.'); if (args[0] === 'DOWN') throw Error('sensitive storage diagnostic'); return { stock: { symbol: args[0] } }; }, getHistory: async (...args) => { calls.push(args); return { records: [] }; } };
  const server = createApp(parseConfig({}), { stockOverview: service, logger: { info() {}, error() {} } }).listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = (path, method = 'GET') => new Promise((resolve, reject) => { const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, method, headers: { Host: '127.0.0.1:7001' } }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.end(); });
  assert.equal((await request('/api/stocks/test.a/overview')).status, 200); assert.deepEqual(calls[0], ['TEST-A', '1Y', undefined]);
  assert.equal((await request('/api/stocks/TEST/research?limit=50')).status, 200);
  for (const path of ['/api/stocks/@bad/overview', '/api/stocks/TEST/overview?range=2Y', '/api/stocks/TEST/overview?apiKey=x', '/api/stocks/TEST/research?limit=51']) assert.equal((await request(path)).status, 400);
  assert.equal((await request('/api/stocks/BAD/overview')).status, 404);
  const down = await request('/api/stocks/DOWN/overview'); assert.equal(down.status, 503); assert.ok(!down.body.includes('sensitive'));
  assert.equal((await request('/api/stocks/TEST/overview', 'DELETE')).status, 403);
});
