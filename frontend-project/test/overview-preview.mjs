// Isolated visual-test server. Uses only test fixtures and built frontend assets.
// It has no database/provider configuration and rejects all mutations.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { overviewFixture, fundamentalsFixture } from '../src/features/stocks/StockResearch.fixtures.ts';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  if (request.method !== 'GET') return json(503, { error: { code: 'PROVIDER_UNAVAILABLE' } });
  if (pathname.startsWith('/api/')) {
    const symbol = pathname.split('/')[3];
    if (pathname === '/api/ready') return json(200, { data: { status: 'ready', database: 'ok' } });
    if (!['TEST', 'PEER'].includes(symbol)) return json(404, { error: { code: 'NOT_FOUND' } });
    if (pathname.endsWith('/overview')) {
      const data = overviewFixture(symbol);
      data.performance.range = new URL(request.url, 'http://127.0.0.1').searchParams.get('range') ?? '1Y';
      return json(200, { data });
    }
    if (pathname.endsWith('/fundamentals')) return json(200, { data: fundamentalsFixture(symbol) });
    if (pathname.endsWith('/filings')) return json(200, { data: { symbol, filings: [] } });
    if (pathname.endsWith('/research')) return json(200, { data: { records: [] } });
    return json(404, { error: { code: 'NOT_FOUND' } });
  }
  const path = pathname.startsWith('/assets/') ? resolve(root, `.${pathname}`) : resolve(root, 'index.html');
  if (!path.startsWith(root)) { response.writeHead(404); return response.end(); }
  try {
    const content = await readFile(path);
    response.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[extname(path)] ?? 'application/octet-stream' }); response.end(content);
  } catch { response.writeHead(404); response.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`Isolated test preview: http://127.0.0.1:${server.address().port}/stocks/TEST`));
setTimeout(() => { server.closeAllConnections(); server.close(); }, 15 * 60000).unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.closeAllConnections(); server.close(); });
