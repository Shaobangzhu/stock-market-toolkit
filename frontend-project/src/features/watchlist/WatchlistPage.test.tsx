import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppProviders } from '../../app/providers';
import { WatchlistPage } from './WatchlistPage';
import type { WatchlistItem } from '../../api/watchlist';

vi.mock('./Sparkline', () => ({ Sparkline: () => <div role="img" aria-label="Last 60 stored daily closing prices" /> }));
const id = '00000000-0000-4000-8000-000000000001';
let items: WatchlistItem[] = [], calls: { path: string; method: string; body?: Record<string, unknown>; headers: unknown }[] = [];
let searchFailure = false, duplicate = false, requestedImport = false;
function fixture(): WatchlistItem {
  // Test-only backend-shaped fixture. Never imported by runtime code.
  return { id, instrumentId: '00000000-0000-4000-8000-000000000002', symbol: 'TEST', company: 'Test Company', exchange: 'NASDAQ', currency: 'USD', researchStatus: 'WATCHING', tags: [], notes: '', revision: 1,
    addedAt: '2026-01-07T00:00:00Z', lastUpdatedAt: '2026-01-07T00:00:00Z', lastPrice: null, dailyChange: null, range52Week: null, fairValue: null, entryZone: null, distanceToEntry: null, fresh: false, freshness: 'unavailable', sparkline: [], latestResearch: null, lastSyncJob: null };
}
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });
beforeEach(() => {
  items = []; calls = []; searchFailure = false; duplicate = false; requestedImport = false;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ path, method, body, headers: init?.headers });
    if (path.startsWith('/api/watchlist?')) {
      const params = new URL(path, 'http://localhost').searchParams;
      const visible = params.get('search') ? items.filter(row => `${row.symbol} ${row.company}`.toLowerCase().includes(params.get('search')!.toLowerCase())) : items;
      return ok({ items: visible, total: items.length, filteredCount: visible.length, availableTags: [...new Set(items.flatMap(row => row.tags))], asOf: '2026-01-07T00:00:00Z',
        summary: { tracked: items.length, archived: 0, nearEntry: 0, researched: 0, priced: 0, fresh: 0 } });
    }
    if (path === '/api/instruments/search') {
      if (searchFailure) return { ok: false, status: 429, json: async () => ({ error: { code: 'PROVIDER_RATE_LIMITED', message: 'Do not reflect this payload' } }) };
      return ok({ results: [{ symbol: 'TEST', name: 'Test Company' }], warning: null });
    }
    if (path === '/api/instruments/resolve') return ok({ resolutionToken: id, symbol: 'TEST', company: 'Test Company', exchange: 'NASDAQ', currency: 'USD', alreadyAdded: duplicate, source: 'TIINGO', expiresAt: '2026-01-07T00:10:00Z' });
    if (path === '/api/watchlist' && method === 'POST') {
      requestedImport = !!body?.initialSync; items = [fixture()];
      return ok({ id, symbol: 'TEST', syncJob: requestedImport ? { id, status: 'QUEUED' } : null, syncError: null });
    }
    if (path === `/api/watchlist/${id}` && method === 'PATCH') {
      items = items.map(row => ({ ...row, ...body, revision: row.revision + 1 } as WatchlistItem)); return ok({ id, revision: items[0]!.revision });
    }
    if (path === `/api/watchlist/${id}` && method === 'DELETE') { items = []; return ok({ id, removed: true }); }
    throw new Error(`Unexpected test request: ${method} ${path}`);
  }));
});
function mount() { return render(<AppProviders><MemoryRouter><WatchlistPage /></MemoryRouter></AppProviders>); }
async function resolveStock(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Add Stock' })[0]!);
  await user.type(screen.getByRole('textbox', { name: 'Ticker or company name' }), 'Test Company');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.click(await screen.findByRole('button', { name: /TEST.*Test Company/ }));
  await screen.findByRole('region', { name: 'Confirmed instrument identity' });
}
describe('complete Watchlist workspace', () => {
  it('shows exact empty copy, zero real counts and makes only a cache-read request', async () => {
    mount(); expect(await screen.findByText('Your Watchlist Is Empty')).toBeInTheDocument();
    expect(screen.getByText('Add your first stock to begin researching price history, fundamentals, and entry opportunities.')).toBeInTheDocument();
    expect(screen.queryByText(/PLTR|UBER|SOFI/)).not.toBeInTheDocument(); expect(calls).toHaveLength(1); expect(calls[0]!.method).toBe('GET');
    expect(calls.some(call => call.path.includes('login') || call.path.includes('/sync'))).toBe(false);
  });
  it('searches by company, shows identity/exchange before confirmation, and adds without silently importing history', async () => {
    const user = userEvent.setup(); mount(); await screen.findByText('Your Watchlist Is Empty'); await resolveStock(user);
    const identity = screen.getByRole('region', { name: 'Confirmed instrument identity' }); expect(within(identity).getByText('NASDAQ')).toBeInTheDocument(); expect(within(identity).getByText('Test Company')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Import daily price history after adding' })).not.toBeChecked();
    expect(calls.some(call => call.path === '/api/watchlist' && call.method === 'POST')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Confirm Add Stock' })); await screen.findByRole('button', { name: 'Select TEST' });
    expect(requestedImport).toBe(false); expect(calls.find(call => call.path === '/api/watchlist' && call.method === 'POST')!.headers).toMatchObject({ 'X-Stock-Research-Lab': '1', 'Content-Type': 'application/json' });
    expect(screen.getAllByText('Not Researched').length).toBeGreaterThan(0); expect(screen.getAllByText('N/A').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Open Research' })).toHaveAttribute('href', '/stocks/TEST'); expect(screen.getByRole('link', { name: 'Open Chart' })).toHaveAttribute('href', '/stocks/TEST?tab=price-volume');
  });
  it('starts initial history only after the explicit checkbox and final confirmation', async () => {
    const user = userEvent.setup(); mount(); await screen.findByText('Your Watchlist Is Empty'); await resolveStock(user);
    await user.click(screen.getByRole('checkbox', { name: 'Import daily price history after adding' }));
    expect((screen.getByLabelText('Historical import start date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await user.click(screen.getByRole('button', { name: 'Confirm Add Stock' })); await screen.findByText('TEST added. Historical synchronization queued.');
    expect(requestedImport).toBe(true);
  });
  it('prevents confirmation for duplicates and reports rate-limit errors without reflecting provider payloads', async () => {
    const user = userEvent.setup(); duplicate = true; mount(); await screen.findByText('Your Watchlist Is Empty'); await resolveStock(user);
    expect(screen.getByText('Already in your Watchlist')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm Add Stock' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' })); searchFailure = true;
    await user.click(screen.getAllByRole('button', { name: 'Add Stock' })[0]!); await user.type(screen.getByRole('textbox', { name: 'Ticker or company name' }), 'limited'); await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Tiingo request limit reached. Wait for the cooldown and retry explicitly.')).toBeInTheDocument(); expect(screen.queryByText('Do not reflect this payload')).not.toBeInTheDocument();
    expect(calls.some(call => call.path === '/api/watchlist' && call.method === 'POST')).toBe(false);
  });
  it('persists research-status changes, custom tags and personal notes through protected API mutations', async () => {
    items = [fixture()]; const user = userEvent.setup(); mount(); await screen.findByRole('button', { name: 'Select TEST' });
    await user.click(screen.getByRole('combobox', { name: 'Research status for TEST' })); await user.click(screen.getByText('Researching', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(items[0]!.researchStatus).toBe('RESEARCHING'));
    await user.click(screen.getByRole('button', { name: 'Edit Tags & Notes' })); await user.type(screen.getByRole('textbox', { name: 'Personal notes' }), 'My saved personal thesis.');
    await user.type(screen.getByRole('combobox', { name: 'Custom tags' }), 'growth{Enter}'); await user.click(screen.getByRole('button', { name: 'Save Annotations' }));
    await waitFor(() => expect(items[0]!.notes).toBe('My saved personal thesis.')); expect(items[0]!.tags).toContain('growth');
    await screen.findByText('My saved personal thesis.'); expect(calls.filter(call => call.method === 'PATCH').length).toBe(2);
  });
  it('removes membership after confirmation and returns to the empty state', async () => {
    items = [fixture()]; const user = userEvent.setup(); mount(); await screen.findByRole('button', { name: 'Select TEST' });
    await user.click(screen.getByRole('button', { name: 'Remove TEST' })); expect(screen.getByText('Saved prices, research, tags and notes are retained.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' })); await screen.findByText('Your Watchlist Is Empty'); expect(calls.some(call => call.method === 'DELETE')).toBe(true);
  });
  it('filters without provider requests and delegates distance sorting/near-entry filtering to the backend', async () => {
    items = [fixture()]; const user = userEvent.setup(); mount(); await screen.findByRole('button', { name: 'Select TEST' });
    await user.click(screen.getByRole('combobox', { name: 'Sort Watchlist' })); await user.click(screen.getByText('Nearest saved entry', { selector: '.ant-select-item-option-content' }));
    await waitFor(() => expect(calls.some(call => call.path.includes('sort=distance'))).toBe(true));
    const switches = screen.getAllByRole('switch'); await user.click(switches[0]!); await waitFor(() => expect(calls.some(call => call.path.includes('nearEntry=true'))).toBe(true));
    await user.type(screen.getByRole('textbox', { name: 'Filter Watchlist' }), 'Missing'); expect(await screen.findByText('No matching stocks')).toBeInTheDocument();
    expect(calls.every(call => call.method === 'GET' && call.path.startsWith('/api/watchlist?'))).toBe(true);
  });
});
