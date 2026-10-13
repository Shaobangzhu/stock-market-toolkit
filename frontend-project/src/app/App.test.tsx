import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { MAIN_NAV_ITEMS } from '../components/Sidebar';
import { fundamentalsFixture, overviewFixture } from '../features/stocks/StockResearch.fixtures';
vi.mock('../features/stocks/PricePerformanceChart', () => ({ PricePerformanceChart: () => <div role="img" aria-label="Historical price performance chart" /> }));

const requests: string[] = [];

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  requests.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    requests.push(String(input));
    const path = String(input), symbol = path.split('/')[3] ?? 'TEST';
    if (path.includes('/overview?')) return { ok: true, status: 200, json: async () => ({ data: overviewFixture(symbol) }) };
    if (path.includes('/fundamentals?')) return { ok: true, status: 200, json: async () => ({ data: fundamentalsFixture(symbol) }) };
    if (path.includes('/filings?')) return { ok: true, status: 200, json: async () => ({ data: { symbol, filings: [] } }) };
    if (path.includes('/research?')) return { ok: true, status: 200, json: async () => ({ data: { records: [] } }) };
    if (String(input) === '/api/ready') {
      return { ok: true, status: 200, json: async () => ({ data: { status: 'ready', database: 'ok' } }) };
    }
    if (String(input).startsWith('/api/watchlist?')) {
      return { ok: true, status: 200, json: async () => ({ data: { items: [], total: 0, filteredCount: 0, availableTags: [], asOf: '2026-01-07T00:00:00Z', summary: { tracked: 0, archived: 0, nearEntry: 0, researched: 0, priced: 0, fresh: 0 } } }) };
    }
    throw new Error('Unexpected API request');
  }));
});

describe('navigation and initial data boundaries', () => {
  it('shows exactly three main navigation items and a polished empty Watchlist', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(MAIN_NAV_ITEMS).toEqual(['Watchlist', 'Stock Research', 'Data & Settings']);
    expect(nav.children).toHaveLength(3);
    for (const label of MAIN_NAV_ITEMS) expect(within(nav).getByText(label)).toBeInTheDocument();
    expect(await screen.findByText('Your Watchlist Is Empty')).toBeInTheDocument();
    expect(screen.queryByText(/PLTR|SOFI|UBER|FIG/)).not.toBeInTheDocument();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatch(/^\/api\/watchlist\?/);
  });

  it('opens a typed symbol without making authentication or provider requests', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Your Watchlist Is Empty');
    await user.type(screen.getByRole('textbox', { name: 'Open stock symbol' }), 'aapl');
    await user.click(screen.getByRole('button', { name: 'Open stock research' }));
    expect(window.location.pathname).toBe('/stocks/AAPL');
    expect(await screen.findByRole('heading', { name: 'AAPL' })).toBeInTheDocument();
    expect(requests.every(path => path.startsWith('/api/watchlist?') || path.startsWith('/api/stocks/AAPL/'))).toBe(true);
  });

  it('keeps the stock header while switching exactly two tabs by query parameter', async () => {
    window.history.replaceState({}, '', '/stocks/TEST?tab=price-volume');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'TEST' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Price & Volume' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Price & Volume workspace')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(window.location.search).toBe('');
    expect(screen.getByRole('heading', { name: 'TEST' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Research History' })).toBeInTheDocument();
    expect(requests.every(path => path.startsWith('/api/stocks/TEST/'))).toBe(true);
  });

  it('opens embedded research history from a direct URL and closes without losing stock context', async () => {
    window.history.replaceState({}, '', '/stocks/TEST?history=open');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText('No research runs yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(window.location.pathname).toBe('/stocks/TEST'));
    expect(window.location.search).toBe('');
    expect(screen.getByRole('heading', { name: 'TEST' })).toBeInTheDocument();
    expect(requests.every(path => path.startsWith('/api/stocks/TEST/'))).toBe(true);
  });

  it('normalizes unsupported tabs to Overview and rejects invalid symbols', async () => {
    window.history.replaceState({}, '', '/stocks/TEST?tab=other');
    const { unmount } = render(<App />);
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    unmount();
    window.history.replaceState({}, '', '/stocks/%40bad');
    render(<App />);
    expect(await screen.findByText('Invalid stock symbol')).toBeInTheDocument();
  });

  it('checks only local database readiness on settings', async () => {
    window.history.replaceState({}, '', '/settings');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Data & Settings' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Ready for local data')).toBeInTheDocument());
    expect(requests).toEqual(['/api/ready']);
  });
});
