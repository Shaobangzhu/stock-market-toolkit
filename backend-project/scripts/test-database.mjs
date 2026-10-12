import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { loadConfig } from '../dist/config/env.js';
import { createDatabase } from '../dist/services/database.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = `srl_test_${randomBytes(12).toString('hex')}`;
let created = false;
let database;
const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
const sql = (query) => docker(['exec', 'srl-postgres', 'psql', '-X', '-U', 'srl_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', query]);
try {
  const main = new URL(loadConfig().DATABASE_URL ?? '');
  const info = JSON.parse(docker(['inspect', 'srl-postgres']))[0];
  // Container metadata stays private: never print full inspect output/environment.
  assert.equal(info.Config.Labels['com.docker.compose.project'], 'stock-research-lab');
  assert.equal(info.Config.Labels['com.docker.compose.service'], 'postgres');
  assert.equal(main.hostname, '127.0.0.1');
  assert.equal(main.pathname, '/stock_research_lab');
  assert.ok(info.NetworkSettings.Ports['5432/tcp'].some((binding) => binding.HostIp === '127.0.0.1' && binding.HostPort === main.port));
  const owner = decodeURIComponent(main.username);
  assert.match(owner, /^[a-z][a-z0-9_]{0,62}$/);
  assert.match(name, /^srl_test_[a-f0-9]{24}$/);
  // CREATE (never IF NOT EXISTS): cleanup is allowed only if this call created it.
  sql(`CREATE DATABASE "${name}" OWNER "${owner}"`);
  created = true;
  const testUrl = new URL(main);
  testUrl.pathname = `/${name}`;
  testUrl.search = '?schema=public';
  const environment = { ...process.env, DATABASE_URL: testUrl.href, SRL_TEST_DATABASE: name };
  const migrate = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: root, env: environment, encoding: 'utf8', timeout: 60_000 });
  assert.equal(migrate.status, 0, 'Fresh test database migration failed; CLI output suppressed to protect credentials.');
  console.log('All migrations replayed successfully in a new isolated test database.');
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test/integration/database.test.mjs', 'test/integration/market-data.test.mjs'], { cwd: root, env: environment, stdio: 'inherit', timeout: 90_000 });
  assert.equal(result.status, 0, 'Integration tests failed.');
  if (process.argv.includes('--restart')) {
    database = createDatabase({ DATABASE_URL: testUrl.href });
    const marker = await database.client.instrument.create({ data: {
      symbol: 'SRL_TEST_PERSISTENCE', exchange: 'TEST', name: 'Test-only persistence marker',
      currency: 'USD', exchangeTimezone: 'America/New_York',
    } });
    await database.close();
    database = undefined;
    docker(['restart', 'srl-postgres']);
    let healthy = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (docker(['inspect', '--format', '{{.State.Health.Status}}', 'srl-postgres']).trim() === 'healthy') { healthy = true; break; }
      await setTimeout(500);
    }
    assert.ok(healthy, 'Project container did not recover after restart.');
    database = createDatabase({ DATABASE_URL: testUrl.href });
    assert.ok(await database.client.instrument.findUnique({ where: { id: marker.id } }));
    console.log('Test fixture and migration persisted across srl-postgres restart.');
  }
} catch {
  console.error('Database integration validation failed. Verify project Docker status and configuration; sensitive diagnostics are suppressed.');
  process.exitCode = 1;
} finally {
  await database?.close();
  if (created) {
    // Only the random database created by THIS invocation; never reset the app DB.
    try { sql(`DROP DATABASE "${name}"`); console.log('Removed only this run\'s temporary test database.'); }
    catch { console.error(`Temporary database cleanup failed: ${name}`); process.exitCode = 1; }
  }
}
