import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SecEdgarProvider } from '../dist/providers/sec-edgar.js';
import { normalizeTickerIndex, normalizeCompanyFacts, normalizeFilings, periodKind } from '../dist/providers/sec-normalization.js';
import { parseProviderJson } from '../dist/providers/tiingo-normalization.js';
import { analyzeFundamentals } from '../dist/services/fundamental-analysis.js';
import { filingAvailableAt } from '../dist/services/sec.js';
import { cik, acc, secConfig, mockSec, companyFacts, disclosure, directory, submission } from './fixtures/sec.mjs';
const parse = value => parseProviderJson(JSON.stringify(value));
const clock = () => new Date('2026-03-05T00:00:00Z');
async function bundle() { const mock = mockSec(); return new SecEdgarProvider(secConfig, { fetch: mock.fetch, now: clock, sleep: async () => {} }).retrieve('TEST', 'NASDAQ'); }
function observations(b) {
  return b.facts.map((fact, i) => {
    const filing = b.filings.find(f => f.accessionNumber === fact.accessionNumber);
    return { id: String(i), ...fact, filedDate: filing.filedDate, acceptedAt: filing.acceptedAt, availableAt: filing.acceptedAt, isAmendment: filing.isAmendment,
      retrievedAt: b.retrievedAt.toISOString(), sourceUrl: filing.primaryDocumentUrl, issuerTickerCount: 1 };
  });
}
test('SEC directory resolves share classes, leading-zero CIKs, exchanges and refuses ambiguity', async () => {
  const index = normalizeTickerIndex(parse(directory));
  assert.equal(index[1].symbol, 'TEST-A'); assert.equal(index[0].cik, cik);
  const mock = mockSec(); const provider = new SecEdgarProvider(secConfig, { fetch: mock.fetch, now: clock, sleep: async () => {} });
  assert.equal((await provider.resolveTicker('test', 'NASDAQ')).cik, cik);
  await assert.rejects(provider.resolveTicker('MISSING', 'NASDAQ'), { status: 422 });
  await assert.rejects(provider.resolveTicker('TEST', 'NYSE'), { status: 422 });
  const ambiguous = mockSec({ directory: { ...directory, data: [...directory.data, [2, 'Other Issuer', 'TEST', 'Nasdaq']] } });
  await assert.rejects(new SecEdgarProvider(secConfig, { fetch: ambiguous.fetch, now: clock }).resolveTicker('TEST', 'NASDAQ'), { status: 409 });
});
test('SEC retrieves recent and archived submissions and companyfacts with bounded caching and real configured User-Agent', async () => {
  const mock = mockSec(); const sleeps = [];
  const provider = new SecEdgarProvider(secConfig, { fetch: mock.fetch, now: clock, sleep: async ms => sleeps.push(ms) });
  const result = await provider.retrieve('TEST', 'NASDAQ');
  assert.equal(result.filings.length, 6); assert.equal(result.historyComplete, true);
  assert.ok(result.filings.some(f => f.form === '8-K')); assert.ok(result.filings.some(f => f.isAmendment));
  assert.ok(result.filings.every(f => f.primaryDocumentUrl.startsWith('https://www.sec.gov/Archives/edgar/data/1/')));
  assert.equal(mock.calls.length, 4); assert.ok(sleeps.every(ms => ms >= 500));
  assert.ok(mock.calls.every(c => c.options.headers['User-Agent'] === secConfig.SEC_EDGAR_USER_AGENT && c.options.redirect === 'error'));
  await provider.retrieve('TEST', 'NASDAQ'); assert.equal(mock.calls.length, 4);
  await assert.rejects(provider.retrieve('TEST', 'NASDAQ', '0000000002'), { status: 409 });
});
test('missing or placeholder SEC contact never falls back to an invented User-Agent', async () => {
  for (const ua of [undefined, 'Lab fake@example.org', 'Lab your-email@host.org', 'Lab fake@local.test']) {
    const mock = mockSec(); const provider = new SecEdgarProvider({ ...secConfig, SEC_EDGAR_USER_AGENT: ua }, { fetch: mock.fetch });
    assert.equal(provider.configured, false); await assert.rejects(provider.resolveTicker('TEST', 'NASDAQ'), { status: 503 }); assert.equal(mock.calls.length, 0);
  }
});
test('SEC fair-access 403/429 blocks retries, honors Retry-After and does not expose response bodies', async () => {
  for (const status of [403, 429]) {
    let calls = 0;
    const provider = new SecEdgarProvider(secConfig, { now: clock, fetch: async () => { calls++; return new Response('private-contact-provider-error', { status, headers: { 'Retry-After': '120' } }); } });
    await assert.rejects(provider.resolveTicker('TEST', 'NASDAQ'), error => { assert.equal(error.status, 429); assert.equal(error.retryAfter.toISOString(), '2026-03-05T00:02:00.000Z'); assert.ok(!error.message.includes('private-contact')); return true; });
    await assert.rejects(provider.resolveTicker('TEST', 'NASDAQ'), { status: 429 }); assert.equal(calls, 1);
  }
});
test('SEC retries network/5xx at most three times; missing data and bad payloads preserve safe failures', async () => {
  let calls = 0;
  const provider = new SecEdgarProvider(secConfig, { now: clock, sleep: async () => {}, fetch: async () => { calls++; throw Error('private-contact'); } });
  await assert.rejects(provider.resolveTicker('TEST', 'NASDAQ'), { status: 502 }); assert.equal(calls, 3);
  for (const response of [new Response('{}', { status: 404 }), new Response('broken', { status: 200 })]) {
    await assert.rejects(new SecEdgarProvider(secConfig, { fetch: async () => response }).resolveTicker('TEST', 'NASDAQ'), e => [422, 502].includes(e.status));
  }
  const bad = mockSec({ submissions: { ...submission(), cik: 2 } });
  await assert.rejects(new SecEdgarProvider(secConfig, { fetch: bad.fetch, sleep: async () => {} }).retrieve('TEST', 'NASDAQ'), { status: 502 });
});
test('SEC periods distinguish annual, standalone quarter, YTD and instantaneous values; duplicate frames are not summed', async () => {
  const b = await bundle(), rows = observations(b);
  assert.equal(periodKind('2025-01-01', '2025-06-30'), 'YTD'); assert.equal(periodKind(null, '2025-06-30'), 'INSTANT');
  const report = analyzeFundamentals(rows, 'USD', 40);
  assert.equal(report.periods.find(p => p.periodEnd === '2025-06-30' && p.periodKind === 'QUARTER').metrics.revenue.value, '400');
  assert.equal(report.periods.find(p => p.periodEnd === '2025-06-30' && p.periodKind === 'YTD').metrics.revenue.value, '700');
  assert.equal(b.facts.filter(f => f.concept === 'Revenues' && f.accessionNumber === acc.annual).length, 1);
  const original = analyzeFundamentals(rows.filter(r => r.availableAt < '2025-03-01'), 'USD', 40);
  const annual = original.periods.find(p => p.periodKind === 'ANNUAL' && p.periodEnd === '2024-12-31');
  assert.equal(annual.metrics.revenue.value, '1000'); assert.equal(annual.metrics.freeCashFlow.value, '200'); assert.equal(annual.metrics.freeCashFlow.derived, true);
  assert.equal(annual.metrics.netMargin.value, '10'); assert.equal(annual.metrics.operatingMargin.value, '20'); assert.equal(annual.metrics.revenueGrowth.value, '25');
  assert.equal(original.periods.find(p => p.periodKind === 'INSTANT').metrics.totalDebt.value, '110');
});
test('publication cutoff excludes amendments; later restatements supersede originals, negative earnings give no positive P/E', async () => {
  const rows = observations(await bundle());
  const market = { close: '20', currency: 'USD', tradingDate: '2025-02-21', provider: 'TIINGO', adjustmentMode: 'RAW', shareBasisVerified: true, freshAtCutoff: true, issuerTickerCount: 1 };
  const before = analyzeFundamentals(rows.filter(r => r.availableAt < '2025-03-01'), 'USD', 40, market);
  assert.equal(before.valuation.priceEarnings.value, '10');
  const after = analyzeFundamentals(rows, 'USD', 40, { ...market, tradingDate: '2025-03-03' });
  const annual = after.periods.find(p => p.periodKind === 'ANNUAL' && p.periodEnd === '2024-12-31');
  assert.equal(annual.metrics.revenue.value, '1200'); assert.equal(annual.metrics.netIncome.value, '-50');
  assert.equal(annual.metrics.operatingMargin.value, null, 'unamended operating income cannot be mixed with amended revenue');
  assert.equal(after.valuation.priceEarnings.value, null); assert.equal(after.valuation.priceEarnings.reason, 'NON_POSITIVE_EARNINGS');
  assert.equal(filingAvailableAt({ acceptedAt: null, filedDate: new Date('2025-03-01T00:00:00Z') }).toISOString(), '2025-03-02T05:00:00.000Z');
});
test('missing units, unsupported debt, ambiguous same-accession corrections and incomparable valuation remain unavailable', async () => {
  const rows = observations(await bundle()).filter(r => r.accessionNumber !== acc.amended);
  const report = analyzeFundamentals(rows.filter(r => r.concept !== 'ShortTermBorrowings'), 'EUR', 40);
  assert.ok(report.periods.every(p => p.metrics.revenue.value === null));
  const conflict = analyzeFundamentals([...rows, { ...rows.find(r => r.concept === 'Revenues' && r.accessionNumber === acc.annual), id: 'conflict', value: '1001' }], 'USD');
  assert.equal(conflict.periods.find(p => p.periodKind === 'ANNUAL').metrics.revenue.reason, 'AMBIGUOUS_DISCLOSURE');
  assert.equal(analyzeFundamentals(rows.filter(r => r.concept !== 'ShortTermBorrowings'), 'USD').periods.find(p => p.periodKind === 'INSTANT').metrics.totalDebt.value, null);
});
test('market-derived Price/Sales requires positive same-date single-class shares and comparable annual revenue', async () => {
  const rows = observations(await bundle()).filter(r => r.accessionNumber !== acc.amended);
  const shares = { ...rows[0], id: 'shares', concept: 'EntityCommonStockSharesOutstanding', taxonomy: 'dei', unit: 'shares', value: '100', periodStart: null, periodEnd: '2025-02-21', issuerTickerCount: 1 };
  const market = { close: '20', currency: 'USD', tradingDate: '2025-02-21', provider: 'TIINGO', adjustmentMode: 'RAW', shareBasisVerified: true, freshAtCutoff: true, issuerTickerCount: 1 };
  assert.equal(analyzeFundamentals([...rows, shares], 'USD', 40, market).valuation.priceSales.value, '2');
  assert.equal(analyzeFundamentals([...rows, shares], 'USD', 40, market).valuation.marketCapitalization.value, '2000');
  const future = { ...shares, availableAt: '2025-02-22T12:00:00Z' };
  assert.equal(analyzeFundamentals([...rows, future], 'USD', 40, market).valuation.priceSales.value, null);
  assert.equal(analyzeFundamentals([...rows, future], 'USD', 40, market).valuation.marketCapitalization.value, null);
  assert.equal(analyzeFundamentals([...rows, { ...shares, issuerTickerCount: 2 }], 'USD', 40, market).valuation.priceSales.value, null);
  assert.equal(analyzeFundamentals(rows, 'USD', 40, { ...market, shareBasisVerified: false }).valuation.priceEarnings.reason, 'UNVERIFIED_SHARE_BASIS');
  assert.equal(analyzeFundamentals(rows, 'USD', 40, { ...market, freshAtCutoff: false }).valuation.priceEarnings.reason, 'STALE_MARKET_PRICE');
  assert.equal(analyzeFundamentals(rows, 'USD', 40, { ...market, tradingDate: '2025-01-02' }).valuation.priceEarnings.reason, 'PRICE_PRECEDES_DISCLOSURE');
});
test('SEC fact validation preserves exact numeric lexemes and rejects out-of-range, malformed and unsupported contexts', () => {
  const facts = companyFacts();
  facts.facts['us-gaap'].Revenues.units.USD = [disclosure('9007199254740993.123456789012', acc.annual, '2024-01-01', '2024-12-31').fact];
  const exact = normalizeCompanyFacts(parse(facts), cik, 1).find(r => r.concept === 'Revenues');
  assert.equal(exact.value, '9007199254740993.123456789012');
  for (const value of ['1e101', '1.1234567890123', 'NaN']) {
    facts.facts['us-gaap'].Revenues.units.USD[0].val = value; assert.throws(() => normalizeCompanyFacts(parse(facts), cik, 1), { status: 502 });
  }
  assert.throws(() => normalizeFilings({ accessionNumber: [], form: ['10-K'], filingDate: [], reportDate: [], primaryDocument: [] }, cik), { status: 502 });
});

test('SEC requests time out, retry transient HTTP failures, and reject nonretryable client errors', async () => {
  let calls = 0;
  const blocked = new SecEdgarProvider(secConfig, { now: clock, sleep: async () => {}, requestTimeoutMs: 5, fetch: async (_url, options) => {
    calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true }));
  } });
  await assert.rejects(blocked.resolveTicker('TEST', 'NASDAQ'), { status: 502 }); assert.equal(calls, 3);
  calls = 0;
  const retry = new SecEdgarProvider(secConfig, { now: clock, sleep: async () => {}, fetch: async () => {
    calls++; return calls === 1 ? new Response('temporary', { status: 503 }) : new Response(JSON.stringify(directory));
  } });
  assert.equal((await retry.resolveTicker('TEST', 'NASDAQ')).cik, cik); assert.equal(calls, 2);
  calls = 0;
  const invalid = new SecEdgarProvider(secConfig, { fetch: async () => { calls++; return new Response('bad', { status: 400 }); } });
  await assert.rejects(invalid.resolveTicker('TEST', 'NASDAQ'), { status: 502 }); assert.equal(calls, 1);
});
