import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { z } from 'zod';
import { createApp } from '../dist/app.js';
import { parseConfig } from '../dist/config/env.js';
import { createApiRouter } from '../dist/routes/index.js';
import { validateRequest } from '../dist/middleware/validate-request.js';
import { HttpError } from '../dist/utils/http-error.js';
import { logger } from '../dist/utils/logger.js';

const config = parseConfig({ NODE_ENV: 'test' });
const writeHeaders = {
  Origin: config.FRONTEND_ORIGIN,
  'Content-Type': 'application/json',
  'X-Stock-Research-Lab': '1',
};

async function serve(t, router = createApiRouter()) {
  const logs = [];
  const app = createApp(config, { router, logger: { info: (entry) => logs.push(entry), error: (entry) => logs.push(entry) } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  const send = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port: server.address().port, path, method,
      agent: false,
      headers: { Host: `127.0.0.1:${config.PORT}`,
        ...(body !== undefined ? { 'Content-Length': Buffer.byteLength(body) } : {}), ...headers },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode, headers: response.headers, text,
        json: text && response.headers['content-type']?.includes('application/json') ? JSON.parse(text) : undefined,
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
  return { app, send, logs };
}

function errorIs(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.json.error.code, code);
  assert.match(response.json.error.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers['x-request-id'], response.json.error.requestId);
  assert.equal('stack' in response.json.error, false);
}

test('health works without auth, secrets, persistence, or query/body inputs', async (t) => {
  const { send } = await serve(t);
  const result = await send('/api/health');
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { data: { status: 'ok', application: 'Stock Research Lab' } });
  assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(result.headers['x-powered-by'], undefined);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.equal((await send('/api/health', { method: 'HEAD' })).text, '');
  errorIs(await send('/api/health?key=synthetic-private-input'), 400, 'VALIDATION_ERROR');
  errorIs(await send('/api/health', { headers: { 'Content-Type': 'application/json' }, body: '{}' }), 400, 'VALIDATION_ERROR');
  const method = await send('/api/health', { method: 'POST', headers: writeHeaders, body: '{}' });
  errorIs(method, 405, 'METHOD_NOT_ALLOWED');
  assert.equal(method.headers.allow, 'GET, HEAD, OPTIONS');
});

test('authentication and JSON-data routes are gone and unknown endpoints return JSON 404', async (t) => {
  const { send } = await serve(t);
  for (const path of ['/api/login', '/api/logout', '/api/isLogin', '/api/register', '/api/getData',
    '/api/showData', '/api/getSingleStockVolume', '/api/showSingleStockVolume', '/api/missing']) {
    errorIs(await send(path), 404, 'NOT_FOUND');
  }
  errorIs(await send('/api/login', { method: 'POST', headers: writeHeaders, body: '{}' }), 404, 'NOT_FOUND');
});

test('CORS allows only configured frontend; exact same-origin backend requests are accepted', async (t) => {
  const { send } = await serve(t);
  const frontend = await send('/api/health', { headers: { Origin: config.FRONTEND_ORIGIN } });
  assert.equal(frontend.status, 200);
  assert.equal(frontend.headers['access-control-allow-origin'], config.FRONTEND_ORIGIN);
  assert.equal(frontend.headers['access-control-allow-credentials'], undefined);
  assert.match(frontend.headers.vary, /Origin/);
  const sameOrigin = await send('/api/health', { headers: { Origin: 'http://127.0.0.1:7001' } });
  assert.equal(sameOrigin.status, 200);
  assert.equal(sameOrigin.headers['access-control-allow-origin'], undefined);
  for (const origin of ['https://evil.example', 'null', 'http://localhost:3000', 'http://localhost:5173.evil.example', 'http://localhost:5173/']) {
    const response = await send('/api/health', { headers: { Origin: origin } });
    errorIs(response, 403, 'ORIGIN_NOT_ALLOWED');
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
  errorIs(await send('/api/health', { headers: { Origin: config.FRONTEND_ORIGIN, 'Sec-Fetch-Site': 'cross-site' } }), 403, 'ORIGIN_NOT_ALLOWED');
});

test('Host checks resist rebinding and ignore forwarded host/origin spoofing', async (t) => {
  const { send } = await serve(t);
  for (const host of ['evil.example:7001', '127.0.0.1:7002', '127.0.0.1.evil.example:7001', '']) {
    errorIs(await send('/api/health', { headers: { Host: host, 'X-Forwarded-Host': '127.0.0.1:7001' } }), 403, 'HOST_NOT_ALLOWED');
  }
  assert.equal((await send('/api/health', { headers: { Host: 'localhost:7001' } })).status, 200);
});

test('preflights enforce origins, methods and headers without running a mutation', async (t) => {
  const { send } = await serve(t);
  const headers = { Origin: config.FRONTEND_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, x-stock-research-lab' };
  const response = await send('/api/future', { method: 'OPTIONS', headers });
  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-origin'], config.FRONTEND_ORIGIN);
  assert.match(response.headers['access-control-allow-headers'], /X-Stock-Research-Lab/);
  for (const patch of [
    { Origin: 'null' }, { Origin: undefined }, { 'Access-Control-Request-Method': 'TRACE' },
    { 'Access-Control-Request-Headers': 'authorization' },
  ]) {
    const requestHeaders = { ...headers, ...patch };
    for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === undefined) delete requestHeaders[key];
    assert.equal((await send('/api/future', { method: 'OPTIONS', headers: requestHeaders })).status, 403);
  }
});

test('write defenses run before handlers and require origin, custom header and JSON for every mutation method', async (t) => {
  const router = createApiRouter();
  let writes = 0;
  router.all('/write-fixture', (_request, response) => { writes += 1; response.sendStatus(204); });
  const { send } = await serve(t, router);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    for (const headers of [{}, { 'Content-Type': 'application/json', 'X-Stock-Research-Lab': '1' },
      { Origin: config.FRONTEND_ORIGIN, 'Content-Type': 'application/json' },
      { ...writeHeaders, 'X-Stock-Research-Lab': 'wrong' }, { ...writeHeaders, Origin: 'null' }]) {
      assert.equal((await send('/api/write-fixture', { method, headers, body: '{}' })).status, 403);
    }
    errorIs(await send('/api/write-fixture', { method, headers: { ...writeHeaders, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'label=example' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  assert.equal(writes, 0);
  assert.equal((await send('/api/write-fixture', { method: 'POST', headers: writeHeaders, body: '{}' })).status, 204);
  assert.equal(writes, 1);
});

test('Zod validates params, query and body, with parsed values in locals and no input reflection', async (t) => {
  const router = createApiRouter();
  const schema = z.object({
    params: z.strictObject({ id: z.string().regex(/^\d+$/) }),
    query: z.strictObject({ page: z.coerce.number().int().positive() }),
    body: z.strictObject({ label: z.string().trim().min(1).max(30) }),
  });
  router.post('/records/:id', validateRequest(schema), (_request, response) => {
    response.status(201).json({ data: response.locals.validated });
  });
  const { send, logs } = await serve(t, router);
  const valid = await send('/api/records/42?page=2', { method: 'POST', headers: writeHeaders, body: '{"label":"  example  "}' });
  assert.equal(valid.status, 201);
  assert.deepEqual(valid.json.data, { params: { id: '42' }, query: { page: 2 }, body: { label: 'example' } });
  for (const [path, body] of [
    ['/api/records/nope?page=2', '{"label":"example"}'],
    ['/api/records/42?page=0', '{"label":"example"}'],
    ['/api/records/42?page=2&page=3', '{"label":"example"}'],
    ['/api/records/42?page=2', '{"unexpected-synthetic-secret":"private"}'],
  ]) {
    const response = await send(path, { method: 'POST', headers: writeHeaders, body });
    errorIs(response, 400, 'VALIDATION_ERROR');
    assert.ok(!response.text.includes('synthetic-secret'));
  }
  errorIs(await send('/api/records/%E0%A4%A?page=2', { method: 'POST', headers: writeHeaders, body: '{}' }), 400, 'INVALID_REQUEST');
  assert.ok(!JSON.stringify(logs).includes('synthetic-secret'));
});

test('malformed/oversized/compressed bodies return bounded parser errors with no input leak', async (t) => {
  const { send, logs } = await serve(t);
  const malformed = await send('/api/health', { method: 'POST', headers: writeHeaders, body: '{"key":"synthetic-private-input"' });
  errorIs(malformed, 400, 'INVALID_JSON');
  const large = await send('/api/health', { method: 'POST', headers: writeHeaders, body: JSON.stringify({ label: 'x'.repeat(40_000) }) });
  errorIs(large, 413, 'PAYLOAD_TOO_LARGE');
  errorIs(await send('/api/health', { method: 'POST', headers: { ...writeHeaders, 'Content-Encoding': 'gzip' }, body: '{}' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  errorIs(await send('/api/health', { method: 'POST', headers: { ...writeHeaders, 'Content-Type': 'application/json; charset=not-real' }, body: '{}' }), 415, 'UNSUPPORTED_MEDIA_TYPE');
  assert.ok(!JSON.stringify(logs).includes('synthetic-private-input'));
  assert.ok(!malformed.text.includes('synthetic-private-input'));
});

test('central error handler catches synchronous/async failures and preserves deliberate HTTP errors', async (t) => {
  const router = createApiRouter();
  router.get('/sync-error', () => { throw new Error('synthetic-upstream-api-key'); });
  router.get('/async-error', async () => { throw new Error('synthetic-database-password'); });
  router.get('/conflict', () => { throw new HttpError(409, 'VALIDATION_ERROR', 'Conflicting request.'); });
  const { send, logs } = await serve(t, router);
  for (const path of ['/api/sync-error?api_key=synthetic-query-secret', '/api/async-error']) {
    const response = await send(path);
    errorIs(response, 500, 'INTERNAL_ERROR');
    assert.ok(!response.text.includes('synthetic-'));
  }
  errorIs(await send('/api/conflict'), 409, 'VALIDATION_ERROR');
  assert.ok(!JSON.stringify(logs).includes('synthetic-'));
});

test('logger drops raw exception, credential, URL and request metadata fields', () => {
  const lines = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => { lines.push(String(chunk)); return true; };
  try {
    logger.error({ event: 'request_failed', status: 500, code: 'INTERNAL_ERROR',
      error: new Error('synthetic-secret'), API_KEY: 'synthetic-secret',
      url: 'https://provider.invalid?api_key=synthetic-secret', body: { password: 'synthetic-secret' },
    });
  } finally {
    process.stderr.write = original;
  }
  assert.deepEqual(JSON.parse(lines.join('')), { level: 'error', event: 'request_failed', status: 500, code: 'INTERNAL_ERROR' });
  assert.ok(!lines.join('').includes('synthetic-secret'));
});
