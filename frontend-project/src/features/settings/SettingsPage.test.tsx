import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './SettingsPage';
import { preferenceFixture, settingsFixture } from './Settings.fixtures';
let requests: { path: string; method: string; body: unknown }[], status = structuredClone(settingsFixture);
let failed = false, csvFailure = false, syncFailure = false;
beforeEach(() => {
  requests = []; status = structuredClone(settingsFixture); failed = false; csvFailure = false; syncFailure = false;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = String(input); requests.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (failed || csvFailure && path.endsWith('/import-csv') || syncFailure && path.endsWith('/retry-sync')) return { ok: false, status: 503, json: async () => ({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Local provider unavailable.' } }) };
    let data: unknown = {};
    if (path.endsWith('/status')) data = status;
    if (path.endsWith('/preferences')) data = init?.method === 'POST' ? JSON.parse(String(init.body)) : preferenceFixture;
    if (path.includes('/jobs?')) data = { jobs: syncFailure ? [{ id: 'fixture-job', symbol: 'TEST', exchange: 'NASDAQ', provider: 'TIINGO', dataset: 'PRICES', status: 'FAILED', createdAt: '2026-06-01', finishedAt: '2026-06-01', errorCode: 'PROVIDER_UNAVAILABLE', retryAfter: null }] : [], nextOffset: null };
    if (path.includes('/coverage?')) data = { instruments: [], nextOffset: null };
    if (path.endsWith('/sync-watchlist')) data = { results: [] };
    if (path.endsWith('/import-csv')) data = { imported: 1 };
    if (path.endsWith('/export-research')) data = { schemaVersion: 'research-export-v1', notes: [] };
    return { ok: true, status: 200, json: async () => ({ data }) };
  }));
});
const mount = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><SettingsPage /></QueryClientProvider>);
it('shows empty database and exactly three honest providers without writes or API key forms', async () => {
  mount(); await screen.findByText('isolated_test_database');
  expect(screen.getByText('0 / 3')).toBeInTheDocument(); expect(screen.getByText('Tiingo')).toBeInTheDocument(); expect(screen.getByText('SEC EDGAR')).toBeInTheDocument(); expect(screen.getByText('OpenAI')).toBeInTheDocument();
  expect(screen.getByText('No synchronization jobs yet.')).toBeInTheDocument(); expect(requests.every(r => r.method === 'GET')).toBe(true);
  expect(screen.queryByRole('textbox', { name: /api key/i })).not.toBeInTheDocument(); expect(screen.queryByText(/PLTR|SOFI|UBER/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Inspect Data Coverage' })); expect(await screen.findByText('No instruments stored.')).toBeInTheDocument();
});
it('does not assume configured providers are online and handles backend failures', async () => {
  status.providers[0] = { ...status.providers[0]!, configured: true, status: 'Unknown / Not Tested' };
  const first = mount(); expect(await screen.findByText('Unknown / Not Tested')).toBeInTheDocument(); expect(screen.getByText('0 / 3')).toBeInTheDocument(); first.unmount();
  failed = true; mount(); expect(await screen.findByText('Backend connection unavailable')).toBeInTheDocument();
});
it('saves preferences only through an explicit protected request and accepts an empty Watchlist sync', async () => {
  mount(); await screen.findByText('isolated_test_database');
  const user = userEvent.setup(); await user.type(screen.getByRole('textbox', { name: 'Optional monthly budget guardrail (USD)' }), '25.10'); await user.click(screen.getByRole('button', { name: 'Save Preferences' }));
  await screen.findByText('Local research preferences saved.'); expect(requests.find(r => r.method === 'POST' && r.path.endsWith('/preferences'))?.body).toMatchObject({ monthlyBudgetUsd: '25.10' });
  await user.click(screen.getByRole('button', { name: 'Sync Watchlist Prices' })); await screen.findByText('0 price jobs accepted. 0 failed.');
});
it('validates CSV through the backend and leaves failures visible; retries failed jobs', async () => {
  csvFailure = true; syncFailure = true; mount(); await screen.findByText('isolated_test_database'); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Import Supported CSV' })); await user.type(screen.getByRole('textbox', { name: 'CSV contents' }), 'invalid'); await user.click(screen.getByRole('button', { name: 'Validate & Import' }));
  await screen.findByText('Local provider unavailable.'); expect(requests.find(r => r.path.endsWith('/import-csv'))?.body).toEqual({ csv: 'invalid' });
  await user.click(screen.getByRole('button', { name: 'Cancel' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Retry Failed Sync' })); await screen.findByText('Local provider unavailable.'); expect(requests.find(r => r.path.endsWith('/retry-sync'))?.body).toEqual({ jobId: 'fixture-job' });
});
it('downloads an actual backend research export', async () => {
  const create = vi.fn(() => 'blob:test'), revoke = vi.fn(); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  mount(); await screen.findByText('isolated_test_database'); await userEvent.click(screen.getByRole('button', { name: 'Export Research Data' })); await screen.findByText('Research export downloaded with original snapshots and metadata.'); expect(create).toHaveBeenCalled(); expect(click).toHaveBeenCalled(); expect(requests.some(r => r.path.endsWith('/export-research'))).toBe(true); click.mockRestore();
});
