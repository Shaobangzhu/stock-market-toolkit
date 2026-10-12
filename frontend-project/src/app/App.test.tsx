import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { MAIN_NAV_ITEMS } from '../components/Sidebar';

const requests: string[] = [];

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  requests.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    requests.push(String(input));
    if (String(input) === '/api/ready') {
      return { ok: true, status: 200, json: async () => ({ data: { status: 'ready', database: 'ok' } }) };
    }
    throw new Error('Unexpected API request');
  }));
});

describe('navigation and initial data boundaries', () => {
  it('shows exactly three main navigation items and a polished empty Watchlist', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(MAIN_NAV_ITEMS).toEqual(['Watchlist', 'Stock Research', 'Data & Settings']);
    expect(nav.children).toHaveLength(3);
    for (const label of MAIN_NAV_ITEMS) expect(within(nav).getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Your watchlist starts here')).toBeInTheDocument();
    expect(screen.queryByText(/PLTR|SOFI|UBER|FIG/)).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('opens a typed symbol without making authentication or provider requests', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByRole('textbox', { name: 'Open stock symbol' }), 'aapl');
    await user.click(screen.getByRole('button', { name: 'Open stock research' }));
    expect(window.location.pathname).toBe('/stocks/AAPL');
    expect(await screen.findByRole('heading', { name: 'AAPL' })).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('keeps the stock header while switching exactly two tabs by query parameter', async () => {
    window.history.replaceState({}, '', '/stocks/TEST?tab=price-volume');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'TEST' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Price & Volume' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No price history yet')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(window.location.search).toBe('');
    expect(screen.getByRole('heading', { name: 'TEST' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Research History' })).toBeInTheDocument();
    expect(requests).toEqual([]);
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
    expect(requests).toEqual([]);
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
