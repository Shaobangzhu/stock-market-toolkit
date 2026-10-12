import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';

// Explicit setup only; never called by install, build, startup, migration, or tests.
// Inspect Docker resources and reserve a free loopback port before running this.
const envPath = new URL('../.env', import.meta.url);
const dockerEnv = new URL('../.env.postgres', import.meta.url);
if (existsSync(dockerEnv)) throw new Error('Local Docker configuration already exists; left unchanged.');
const source = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const existing = parse(source).DATABASE_URL;
const port = process.argv[2] ?? '5437';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('Invalid port.');
const url = new URL(existing || `postgresql://stock_research_user:${randomBytes(32).toString('hex')}@127.0.0.1:${port}/stock_research_lab?schema=public`);
const username = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== port
  || url.pathname !== '/stock_research_lab' || !/^[a-z][a-z0-9_]{0,62}$/.test(username)
  || ['postgres', 'srl_admin'].includes(username) || !password || /[\r\n\0']/.test(password)) {
  throw new Error('DATABASE_URL is not compatible with the isolated project database; no files changed.');
}
// Single-quoted dotenv values prevent Compose dollar interpolation.
writeFileSync(dockerEnv, `SRL_POSTGRES_PORT=${port}\nSRL_APP_USER=${username}\nSRL_APP_PASSWORD='${password}'\nSRL_ADMIN_PASSWORD=${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
if (!existing) {
  const updated = /^DATABASE_URL=.*$/m.test(source)
    ? source.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url.href}`)
    : `${source}\nDATABASE_URL=${url.href}\n`;
  writeFileSync(envPath, updated, { mode: 0o600 });
}
console.log(`Local database configuration prepared for 127.0.0.1:${port}; credentials omitted.`);
