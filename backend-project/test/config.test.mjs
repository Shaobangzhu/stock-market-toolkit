import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { ConfigError, parseConfig } from '../dist/config/env.js';

test('defaults allow startup without a database or any optional provider credentials', () => {
  const config = parseConfig({});
  assert.equal(config.HOST, '127.0.0.1');
  assert.equal(config.PORT, 7001);
  assert.equal(config.FRONTEND_ORIGIN, 'http://localhost:5173');
  assert.equal(config.PRIMARY_MARKET_DATA_PROVIDER, 'tiingo');
  assert.equal(config.FALLBACK_MARKET_DATA_PROVIDER, 'twelve_data');
  assert.equal(config.SEC_EDGAR_MAX_RPS, 2);
  for (const field of ['DATABASE_URL', 'TIINGO_API_KEY', 'TWELVE_DATA_API_KEY', 'OPENAI_API_KEY', 'SEC_EDGAR_USER_AGENT']) {
    assert.equal(config[field], undefined);
    assert.equal(parseConfig({ [field]: '   ' })[field], undefined);
  }
  assert.ok(Object.isFrozen(config));
});

test('supported configuration is coerced and unknown environment fields are not retained', () => {
  const config = parseConfig({
    NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '7002',
    FRONTEND_ORIGIN: 'http://127.0.0.1:5173',
    DATABASE_URL: 'postgresql://local:synthetic-password@127.0.0.1:5437/new_lab',
    TIINGO_API_KEY: 'synthetic-tiingo', TWELVE_DATA_API_KEY: 'synthetic-twelve',
    PRIMARY_MARKET_DATA_PROVIDER: 'twelve_data', FALLBACK_MARKET_DATA_PROVIDER: 'tiingo',
    OPENAI_API_KEY: 'synthetic-openai', OPENAI_MODEL: 'configured-model',
    SEC_EDGAR_USER_AGENT: 'StockResearchLab test@example.org', SEC_EDGAR_MAX_RPS: '3',
    UNRELATED_SECRET: 'synthetic-unrelated',
  });
  assert.equal(config.PORT, 7002);
  assert.equal(config.SEC_EDGAR_MAX_RPS, 3);
  assert.equal(config.OPENAI_MODEL, 'configured-model');
  assert.equal('UNRELATED_SECRET' in config, false);
});

test('invalid configuration reports only field names, never supplied values', async (t) => {
  const cases = [
    ['NODE_ENV', 'synthetic-private-value'], ['HOST', '0.0.0.0'], ['HOST', 'evil.example'],
    ['PORT', ''], ['PORT', '0'], ['PORT', '65536'], ['PORT', '7001.5'], ['PORT', 'not-a-number'],
    ['FRONTEND_ORIGIN', 'https://remote.example'], ['FRONTEND_ORIGIN', 'http://localhost:5173/'],
    ['FRONTEND_ORIGIN', 'http://localhost:5173/path'], ['FRONTEND_ORIGIN', 'http://localhost:5173?key=synthetic-private-value'],
    ['FRONTEND_ORIGIN', 'http://user:synthetic-private-value@localhost:5173'],
    ['DATABASE_URL', 'postgresql://local:synthetic-private-value@remote.example/db'],
    ['DATABASE_URL', 'not-a-url-synthetic-private-value'], ['DATABASE_URL', 'http://localhost/db'],
    ['PRIMARY_MARKET_DATA_PROVIDER', 'alpha_vantage'], ['FALLBACK_MARKET_DATA_PROVIDER', 'tiingo'],
    ['OPENAI_MODEL', ''], ['SEC_EDGAR_MAX_RPS', '0'], ['SEC_EDGAR_MAX_RPS', '11'],
    ['SEC_EDGAR_MAX_RPS', '1.5'], ['SEC_EDGAR_USER_AGENT', 'no-contact'],
    ['SEC_EDGAR_USER_AGENT', 'Test contact@example.org\r\nInjected: synthetic-private-value'],
  ];
  for (const [index, [field, value]] of cases.entries()) {
    await t.test(`${field}: rejects invalid case ${index + 1}`, () => {
      assert.throws(() => parseConfig({ [field]: value }), (error) => {
        assert.ok(error instanceof ConfigError);
        assert.deepEqual(error.fields, [field]);
        assert.equal(error.message, `Invalid configuration fields: ${field}`);
        assert.ok(!error.stack.includes('synthetic-private-value'));
        return true;
      });
    });
  }
});

test('dotenv loads the backend-relative file before validation and respects process overrides', (t) => {
  // Isolate a synthetic .env; never read or modify the user's real .env in this test.
  const directory = mkdtempSync(join(tmpdir(), 'stock-lab-env-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'dist', 'config'), { recursive: true });
  copyFileSync(new URL('../dist/config/env.js', import.meta.url), join(directory, 'dist', 'config', 'env.js'));
  symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(join(directory, '.env'), 'PORT=7771\nTIINGO_API_KEY=synthetic-file-key\nOPENAI_API_KEY=synthetic-file-openai\n');
  const configUrl = pathToFileURL(join(directory, 'dist', 'config', 'env.js')).href;
  const script = `
    import assert from 'node:assert/strict';
    import { loadConfig } from ${JSON.stringify(configUrl)};
    const config = loadConfig();
    assert.equal(config.PORT, 7772);
    assert.equal(config.TIINGO_API_KEY, 'synthetic-process-key');
    assert.equal(config.OPENAI_API_KEY, 'synthetic-file-openai');
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: tmpdir(), env: { PORT: '7772', TIINGO_API_KEY: 'synthetic-process-key' }, encoding: 'utf8',
  });
  assert.equal(output, '', 'dotenv and config must not print keys or banners');
});
