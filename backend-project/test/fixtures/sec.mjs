// Synthetic SEC-shaped fixtures; never loaded by application code or personal DB.
export const cik = '0000000001';
export const secConfig = { SEC_EDGAR_USER_AGENT: 'StockResearchLab owner@research-lab.org', SEC_EDGAR_MAX_RPS: 2 };
export const acc = { prior: '0000000001-24-000001', annual: '0000000001-25-000001', amended: '0000000001-25-000002', q1: '0000000001-25-000003', q2: '0000000001-25-000004', event: '0000000001-25-000005' };
const filings = [
  [acc.prior, '10-K', '2024-02-20', '2023-12-31'], [acc.annual, '10-K', '2025-02-20', '2024-12-31'],
  [acc.amended, '10-K/A', '2025-03-01', '2024-12-31'], [acc.q1, '10-Q', '2025-05-01', '2025-03-31'],
  [acc.q2, '10-Q', '2025-07-31', '2025-06-30'], [acc.event, '8-K', '2025-08-01', '2025-08-01'],
];
export function filingColumns(rows) {
  return { accessionNumber: rows.map(r => r[0]), form: rows.map(r => r[1]), filingDate: rows.map(r => r[2]), reportDate: rows.map(r => r[3]),
    acceptanceDateTime: rows.map(r => `${r[2]}T18:00:00Z`), primaryDocument: rows.map(r => `${r[1].replace('/', '')}.htm`) };
}
export const directory = { fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1, 'Test Issuer', 'TEST', 'Nasdaq'], [1, 'Test Issuer', 'TEST.A', 'NYSE']] };
export function submission(tickers = ['TEST']) {
  return { cik: 1, name: 'Test Issuer', tickers, exchanges: tickers.map(() => 'Nasdaq'), filings: { recent: filingColumns(filings.slice(1)), files: [{ name: `CIK${cik}-submissions-001.json`, filingFrom: '2024-02-20', filingTo: '2024-02-20' }] } };
}
export const archive = filingColumns(filings.slice(0, 1));
export function disclosure(value, accessionNumber, start, end, unit = 'USD') {
  const filing = filings.find(r => r[0] === accessionNumber);
  return { unit, fact: { val: value, accn: accessionNumber, ...(start ? { start } : {}), end, filed: filing[2], form: filing[1], fy: Number(end.slice(0, 4)), fp: filing[1].startsWith('10-K') ? 'FY' : 'Q2' } };
}
export function companyFacts() {
  const result = { cik: 1, entityName: 'Test Issuer', facts: { 'us-gaap': {}, dei: {} } };
  const add = (tag, entries, taxonomy = 'us-gaap') => {
    const units = {};
    for (const { unit, fact } of entries) (units[unit] ??= []).push(fact);
    result.facts[taxonomy][tag] = { label: tag, description: 'Test fixture', units };
  };
  const annual = (value, key = 'annual') => disclosure(value, acc[key], '2024-01-01', '2024-12-31');
  add('Revenues', [disclosure(800, acc.prior, '2023-01-01', '2023-12-31'), annual(1000), annual(1000), annual(1200, 'amended'),
    disclosure(300, acc.q1, '2025-01-01', '2025-03-31'), disclosure(700, acc.q2, '2025-01-01', '2025-06-30'), disclosure(400, acc.q2, '2025-04-01', '2025-06-30')]);
  add('NetIncomeLoss', [annual(100), annual(-50, 'amended')]);
  add('EarningsPerShareDiluted', [disclosure(2, acc.annual, '2024-01-01', '2024-12-31', 'USD/shares'), disclosure(-1, acc.amended, '2024-01-01', '2024-12-31', 'USD/shares')]);
  add('OperatingIncomeLoss', [annual(200)]);
  add('NetCashProvidedByUsedInOperatingActivities', [annual(250), disclosure(100, acc.q2, '2025-01-01', '2025-06-30')]);
  add('PaymentsToAcquirePropertyPlantAndEquipment', [annual(50), disclosure(20, acc.q2, '2025-01-01', '2025-06-30')]);
  add('CashAndCashEquivalentsAtCarryingValue', [disclosure(150, acc.annual, null, '2024-12-31')]);
  add('LongTermDebtCurrent', [disclosure(20, acc.annual, null, '2024-12-31')]);
  add('LongTermDebtNoncurrent', [disclosure(80, acc.annual, null, '2024-12-31')]);
  add('ShortTermBorrowings', [disclosure(10, acc.annual, null, '2024-12-31')]);
  return result;
}
export const jsonResponse = payload => new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
export function mockSec(overrides = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (overrides.fetch) return overrides.fetch(url, options);
    if (url.endsWith('company_tickers_exchange.json')) return jsonResponse(overrides.directory ?? directory);
    if (url.includes('/api/xbrl/')) return jsonResponse(overrides.facts ?? companyFacts());
    if (url.endsWith('-submissions-001.json')) return jsonResponse(archive);
    return jsonResponse(overrides.submissions ?? submission());
  };
  return { calls, fetch };
}
