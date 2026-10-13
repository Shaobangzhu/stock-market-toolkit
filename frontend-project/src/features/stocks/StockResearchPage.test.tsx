import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProviders } from '../../app/providers';
import { StockResearchPage } from './StockResearchPage';
import { fundamentalsFixture, overviewFixture } from './StockResearch.fixtures';
import type { StockOverview, Fundamentals } from '../../api/stocks';
vi.mock('./PricePerformanceChart', () => ({ PricePerformanceChart: () => <div role="img" aria-label="Historical price performance chart" /> }));
let overview: StockOverview, fundamentals: Fundamentals, fail = '', calls: { path: string; method: string }[];
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });
beforeEach(() => {
  overview = overviewFixture(); fundamentals = fundamentalsFixture(); fail = ''; calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET'; calls.push({ path, method });
    const symbol = path.split('/')[3]!;
    if (path.includes('/overview')) { if (symbol === 'BAD' || fail === 'overview') return { ok: false, status: symbol === 'BAD' ? 404 : 503, json: async () => ({ error: { code: symbol === 'BAD' ? 'NOT_FOUND' : 'DATABASE_UNAVAILABLE' } }) };
      const data = symbol === 'PEER' ? overviewFixture('PEER') : structuredClone(overview); data.performance.range = new URL(path, 'http://localhost').searchParams.get('range') as StockOverview['performance']['range']; return ok(data); }
    if (path.includes('/fundamentals?')) { if (fail === 'fundamentals') return { ok: false, status: 503, json: async () => ({ error: { code: 'DATABASE_UNAVAILABLE' } }) }; return ok(fundamentals); }
    if (path.includes('/filings?')) return ok({ symbol, filings: [] });
    if (path.includes('/research?')) return ok({ records: overview.history });
    if (path.endsWith('/sync')) return { ok: false, status: 429, json: async () => ({ error: { code: 'PROVIDER_RATE_LIMITED' } }) };
    throw Error(`Unexpected test request ${path}`);
  }));
});
function mount(path = '/stocks/TEST') { return render(<AppProviders><MemoryRouter initialEntries={[path]}><Link to="/stocks/PEER">Choose another ticker</Link><Routes><Route path="/stocks/:symbol" element={<StockResearchPage />} /></Routes></MemoryRouter></AppProviders>); }
describe('Stock Research Overview', () => {
  it('renders real API identity, EOD provenance, six sections, partial coverage and honest empty research without any writes', async () => {
    mount(); expect(await screen.findByRole('heading', { name: 'TEST' })).toBeInTheDocument();
    expect(screen.getByText('EOD close · 2026-01-06 · TIINGO · RAW')).toBeInTheDocument(); expect(screen.getByText('Market data is stale')).toBeInTheDocument();
    for (const name of ['Price Performance', 'Company Overview', 'Valuation Snapshot', 'Entry Research', 'News & AI', 'Research History']) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'Historical price performance chart' })).toBeInTheDocument();
    expect(screen.getByText(/Incomplete or unverified coverage/)).toBeInTheDocument(); expect(screen.getByText('No valuation scenario saved yet.')).toBeInTheDocument(); expect(screen.getByText('No research history yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate AI Research/ })).toBeDisabled(); expect(calls.every(call => call.method === 'GET')).toBe(true);
  });
  it('changes chart windows without replacing the persistent stock header and retains exactly two tabs', async () => {
    const user = userEvent.setup(); mount(); const header = await screen.findByRole('heading', { name: 'TEST' });
    await user.click(screen.getByText('MAX')); await waitFor(() => expect(calls.some(call => call.path.endsWith('range=MAX'))).toBe(true));
    expect(screen.getByRole('heading', { name: 'TEST' })).toBe(header);
    expect(screen.getAllByRole('tab')).toHaveLength(2); await user.click(screen.getByRole('tab', { name: 'Price & Volume' })); expect(screen.getByText('Price & Volume workspace')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Overview' })); expect(screen.getByRole('radio', { name: 'MAX' })).toBeChecked();
  });
  it('handles a syntactically invalid symbol without requests and an unknown saved ticker with a 404 state', async () => {
    const view = mount('/stocks/%40bad'); expect(screen.getByText('Invalid stock symbol')).toBeInTheDocument(); expect(calls).toEqual([]); view.unmount();
    mount('/stocks/BAD'); expect(await screen.findByText('Stock not found')).toBeInTheDocument(); expect(calls).toHaveLength(1);
  });
  it('handles unavailable storage and missing fundamentals without inventing values', async () => {
    fail = 'overview'; const view = mount(); expect(await screen.findByText('Stock Research unavailable')).toBeInTheDocument(); view.unmount();
    fail = 'fundamentals'; mount(); await screen.findByRole('heading', { name: 'TEST' }); expect(await screen.findByText('Company fundamentals unavailable')).toBeInTheDocument(); expect(screen.getAllByText('N/A').length).toBeGreaterThan(5);
  });
  it('uses backend annual ratios and reporting context rather than recomputing values from quarterly facts', async () => {
    fundamentals.valuation.priceEarnings = { value: null, unit: 'ratio', derived: true, reason: 'NON_POSITIVE_EARNINGS', sources: [] };
    const revenue = { value: '1000', unit: 'USD', derived: false, reason: null, sources: [] };
    fundamentals.periods = [{ periodStart: '2026-01-01', periodEnd: '2026-03-31', periodKind: 'QUARTER', currency: 'USD', metrics: { revenue: { ...revenue, value: '9999' } } }, { periodStart: '2025-01-01', periodEnd: '2025-12-31', periodKind: 'ANNUAL', currency: 'USD', metrics: { revenue } }];
    mount(); expect(await screen.findByText(/Annual period: 2025-01-01/)).toBeInTheDocument(); expect(screen.getByText('non positive earnings')).toBeInTheDocument(); expect(screen.getByText('$1,000.00')).toBeInTheDocument(); expect(screen.queryByText('$9,999.00')).not.toBeInTheDocument();
  });
  it('opens a selected saved report in the right Drawer and preserves chart range on close', async () => {
    overview.history = [{ id: 'report-1', completedAt: '2026-01-07T19:00:00Z', type: 'AI Report', version: 2, dataCutoff: '2026-01-06T20:00:00Z', fairValue: { lower: '10', upper: '15', currency: 'USD' } }];
    const user = userEvent.setup(); mount(); await screen.findByRole('heading', { name: 'TEST' }); await user.click(screen.getByText('3M'));
    await user.click(screen.getByRole('button', { name: '2026-01-07' })); const dialog = await screen.findByRole('dialog'); expect(within(dialog).getByText('AI Report · v2')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close' })); expect(screen.getByRole('radio', { name: '3M' })).toBeChecked();
  });
  it('switching ticker clears previous panels and report selection', async () => {
    const user = userEvent.setup(); mount(); await screen.findByRole('heading', { name: 'TEST' }); await user.click(screen.getByRole('link', { name: 'Choose another ticker' }));
    expect(await screen.findByRole('heading', { name: 'PEER' })).toBeInTheDocument(); expect(screen.queryByRole('heading', { name: 'TEST' })).not.toBeInTheDocument(); expect(screen.getAllByText('Company PEER').length).toBeGreaterThan(0);
  });
  it('sync requires explicit confirmation and displays rate-limit failures while retaining the cache', async () => {
    const user = userEvent.setup(); mount(); await screen.findByRole('heading', { name: 'TEST' }); await user.click(screen.getByRole('button', { name: /Sync Data/ }));
    expect(calls.every(call => call.method === 'GET')).toBe(true); expect(screen.getByRole('checkbox', { name: /Also synchronize SEC/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Start Sync' })); expect(await screen.findByText(/Tiingo request limit reached/)).toBeInTheDocument(); expect(screen.getByText('EOD close · 2026-01-06 · TIINGO · RAW')).toBeInTheDocument();
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(1);
  });
  it('displays saved sourced qualitative evidence and the actual last report date without starting research', async () => {
    overview.stock.latestResearch = { id: 'report-1', completedAt: '2026-01-07T19:00:00Z', version: 1, summary: 'Saved test-only report summary' };
    overview.news.headlines = [{ title: 'Saved test-only headline', url: 'https://example.com/news', publishedAt: '2026-01-06T12:00:00Z' }];
    overview.news.bullishDrivers = [{ text: 'Saved test-only cited driver', sources: [{ title: 'Evidence', url: 'https://example.com/news' }] }];
    mount(); expect(await screen.findByRole('link', { name: 'Saved test-only headline' })).toHaveAttribute('href', 'https://example.com/news');
    expect(screen.getByText('Saved test-only cited driver')).toBeInTheDocument(); expect(screen.getByText('Last AI report: 2026-01-07')).toBeInTheDocument();
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });
});
