import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const entrypoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const environment = {
  NODE_ENV: 'test', HOST: '127.0.0.1', FRONTEND_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: '', TIINGO_API_KEY: '', OPENAI_API_KEY: '',
  OPENAI_MODEL: 'configured-model', SEC_EDGAR_USER_AGENT: '', SEC_EDGAR_MAX_RPS: '2',
};

async function unusedPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function start(t, overrides = {}) {
  // Override every recognized field, so real .env credentials never enter these tests.
  const child = spawn(process.execPath, [entrypoint], { cwd: tmpdir(), env: { ...environment, ...overrides }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.on('data', (chunk) => { output.stderr += chunk; });
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await closed;
  });
  return { child, output, closed };
}

test('compiled entrypoint starts with no optional credentials and shuts down cleanly', { timeout: 10_000 }, async (t) => {
  const port = await unusedPort();
  const { child, output, closed } = start(t, { PORT: String(port) });
  while (!output.stdout.includes('server_started')) {
    await Promise.race([
      once(child.stdout, 'data'),
      closed.then(() => { throw new Error('Server exited before startup.'); }),
    ]);
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'ok');
  assert.equal(output.stderr, '');
  child.kill('SIGTERM');
  const [code, signal] = await closed;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.ok(output.stdout.includes('server_stopping'));
});

test('invalid startup config exits 1 and prints field names without credential values', { timeout: 10_000 }, async (t) => {
  const { output, closed } = start(t, {
    PORT: 'not-a-port', DATABASE_URL: 'postgresql://user:synthetic-secret@remote.example/db',
    TIINGO_API_KEY: 'synthetic-secret', OPENAI_API_KEY: 'synthetic-secret',
  });
  const [code] = await closed;
  assert.equal(code, 1);
  assert.equal(output.stdout, '');
  const entry = JSON.parse(output.stderr);
  assert.equal(entry.event, 'configuration_invalid');
  assert.deepEqual(entry.fields.sort(), ['DATABASE_URL', 'PORT']);
  assert.ok(!output.stderr.includes('synthetic-secret'));
  assert.ok(!output.stderr.includes('remote.example'));
});

test('listen failures exit 1 with a safe operational error', { timeout: 10_000 }, async (t) => {
  const occupied = createServer();
  occupied.listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const { output, closed } = start(t, { PORT: String(occupied.address().port), TIINGO_API_KEY: 'synthetic-secret' });
  const [code] = await closed;
  assert.equal(code, 1);
  assert.equal(JSON.parse(output.stderr).event, 'server_start_failed');
  assert.ok(!output.stderr.includes('synthetic-secret'));
});
