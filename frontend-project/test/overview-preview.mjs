// Isolated visual-test server. Uses only test fixtures and built frontend assets.
// It has no database/provider configuration. Calculation is pure; saves are rejected.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { overviewFixture, fundamentalsFixture } from '../src/features/stocks/StockResearch.fixtures.ts';
import { dailyHistory, dailyBar, pricePage } from '../src/features/stocks/PriceVolume.fixtures.ts';
import { valuationSchema } from '../../backend-project/dist/services/valuation-engine.js';
import { calculateSnapshot } from '../../backend-project/dist/services/valuation.js';
const valuationSnapshot = cutoff => ({ cutoff, instrument: { id: 'preview-only', symbol: 'TEST', exchange: 'NASDAQ', currency: 'USD' }, price: null, facts: [] });
const previewBars = dailyHistory().map((bar, i) => dailyBar(bar.tradingDate, Number((100 + i * 0.2 + 4 * Math.sin(i / 5)).toFixed(2))));
const previewReports = [{ id: 'preview-report-1', completedAt: '2026-03-02T15:00:00Z', type: 'AI Report', version: 1, dataCutoff: '2026-02-27T20:00:00Z', fairValue: null }];
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  if (request.method === 'POST' && pathname === '/api/stocks/TEST/valuation/calculate') {
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 32000) return json(413, { error: { code: 'PAYLOAD_TOO_LARGE' } }); }
    try { const input = valuationSchema.parse(JSON.parse(body)); return json(200, { data: calculateSnapshot(input, valuationSnapshot(input.cutoff)) }); }
    catch (error) { return json(error.status ?? 400, { error: { code: error.code ?? 'VALIDATION_ERROR', message: error.publicMessage ?? 'Check the valuation input bounds.' } }); }
  }
  if (request.method !== 'GET') return json(503, { error: { code: 'PROVIDER_UNAVAILABLE' } });
  if (pathname.startsWith('/api/')) {
    const symbol = pathname.split('/')[3];
    if (pathname === '/api/ready') return json(200, { data: { status: 'ready', database: 'ok' } });
    if (!['TEST', 'PEER'].includes(symbol)) return json(404, { error: { code: 'NOT_FOUND' } });
    if (pathname.endsWith('/valuation/scenarios')) return json(200, { data: [] });
    if (pathname.endsWith('/valuation/sources')) return json(200, { data: valuationSnapshot(new URL(request.url, 'http://127.0.0.1').searchParams.get('cutoff')) });
    if (pathname.endsWith('/overview')) {
      const data = overviewFixture(symbol);
      data.asOf = '2026-05-01T20:00:00Z'; data.history = previewReports;
      data.stock.lastPrice = { value: previewBars.at(-1).close, tradingDate: previewBars.at(-1).tradingDate, retrievedAt: previewBars.at(-1).retrievedAt, provider: 'TIINGO', adjustmentMode: 'RAW' };
      data.stock.dailyChange = null;
      data.stock.entryZone = { lower: '105', upper: '110', currency: 'USD', scenarioId: 'preview-scenario', method: 'Isolated preview assumption', savedAt: '2026-03-01T15:00:00Z', dataCutoff: '2026-02-27T20:00:00Z', basis: 'TIINGO:DAY:RAW' };
      data.performance.range = new URL(request.url, 'http://127.0.0.1').searchParams.get('range') ?? '1Y';
      return json(200, { data });
    }
    if (pathname.endsWith('/fundamentals')) return json(200, { data: fundamentalsFixture(symbol) });
    if (pathname.endsWith('/prices')) {
      const adjusted = new URL(request.url, 'http://127.0.0.1').searchParams.get('adjustment') === 'total-return';
      return json(200, { data: pricePage(previewBars.map(bar => adjusted ? { ...bar, adjustmentMode: 'TOTAL_RETURN', open: String(Number(bar.open) / 2), high: String(Number(bar.high) / 2), low: String(Number(bar.low) / 2), close: String(Number(bar.close) / 2), volume: '2000' } : bar), symbol) });
    }
    if (pathname.endsWith('/filings')) return json(200, { data: { symbol, filings: [{ id: 'preview-filing', form: '10-K', filedDate: '2026-03-16', reportPeriod: '2025-12-31', sourceUrl: 'https://www.sec.gov/edgar/search/' }] } });
    if (pathname.endsWith('/research')) return json(200, { data: { records: previewReports } });
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
