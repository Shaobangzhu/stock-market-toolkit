import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppProviders } from '../../app/providers';
import { StockResearchPage } from './StockResearchPage';
import { overviewFixture } from './StockResearch.fixtures';
import { dailyHistory, pricePage } from './PriceVolume.fixtures';
import type { StockOverview } from '../../api/stocks';
import type { DailyBar } from '../../api/prices';
import type { PriceVolumeChartProps } from './PriceVolumeChart';
import { chartEvents, exchangeDate, observationAnchor } from './chart-events';
let chart: PriceVolumeChartProps | undefined;
vi.mock('./PriceVolumeChart', () => ({ PriceVolumeChart: (props: PriceVolumeChartProps) => { chart = props; return <div role="img" aria-label="Test chart"><button onClick={() => props.onEvent(props.events.find(event => event.kind === 'research')!)}>Select research marker</button></div>; } }));
vi.mock('./PricePerformanceChart', () => ({ PricePerformanceChart: () => <div /> }));
let data: StockOverview, bars: DailyBar[], failure = '', partial = false, calls: string[];
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) });
beforeEach(() => {
  data = overviewFixture(); data.asOf = '2026-05-01T20:00:00Z'; bars = dailyHistory(); failure = ''; partial = false; calls = []; chart = undefined;
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    expect(init?.method ?? 'GET').toBe('GET'); calls.push(path); const url = new URL(path, 'http://localhost');
    if (url.pathname.endsWith('/overview')) return ok(data);
    if (url.pathname.endsWith('/prices')) {
      if (failure === 'prices' || (failure === 'adjusted' && url.searchParams.get('adjustment') === 'total-return')) return { ok: false, status: 503, json: async () => ({ error: { code: 'DATABASE_UNAVAILABLE' } }) };
      const adjusted = url.searchParams.get('adjustment') === 'total-return';
      const page = pricePage(adjusted ? bars.map(bar => ({ ...bar, adjustmentMode: 'TOTAL_RETURN' as const, open: String(Number(bar.open) / 2), high: String(Number(bar.high) / 2), low: String(Number(bar.low) / 2), close: String(Number(bar.close) / 2), volume: String(Number(bar.volume) * 2) })).slice(partial ? 1 : 0) : bars);
      page.adjustmentMode = adjusted ? 'TOTAL_RETURN' : 'RAW'; return ok(page);
    }
    if (url.pathname.endsWith('/filings')) return ok({ symbol: 'TEST', filings: [] });
    if (url.pathname.endsWith('/research')) return ok({ records: data.history });
    if (url.pathname === '/api/research/history') return ok({ records: data.history, nextOffset:null });
    if (url.pathname.endsWith('/fundamentals')) return ok({ symbol: 'TEST', asOf: data.asOf, periods: [], valuation: { priceEarnings: { value: null, unit: 'ratio', derived: true, reason: 'MISSING', sources: [] }, priceSales: { value: null, unit: 'ratio', derived: true, reason: 'MISSING', sources: [] } }, freshness: { status: 'unavailable', lastSuccessAt: null, lastErrorCode: null }, limitations: [] });
    throw Error(`Unexpected request ${path}`);
  }));
});
function mount() { return render(<AppProviders><MemoryRouter initialEntries={['/stocks/TEST?tab=price-volume']}><Routes><Route path="/stocks/:symbol" element={<StockResearchPage />} /></Routes></MemoryRouter></AppProviders>); }
it('direct tab load keeps stock header/two tabs and renders full cached workspace with unsupported ranges disabled', async () => {
  mount(); await screen.findByRole('img', { name: 'Test chart' }); expect(screen.getByRole('heading', { name: 'TEST' })).toBeInTheDocument(); expect(screen.getAllByRole('tab')).toHaveLength(2);
  expect(screen.getByRole('radio', { name: '6M' })).toBeDisabled(); expect(screen.getByRole('radio', { name: 'MAX' })).toBeChecked();
  expect(screen.getByText('No valuation scenario saved yet.')).toBeInTheDocument(); expect(screen.getByText(/No verified events/)).toBeInTheDocument(); expect(calls.some(path => path.includes('limit=200'))).toBe(true);
  expect(chart?.controls.type).toBe('candlestick'); expect(chart?.analysis.rows[0]?.bar?.adjustmentMode).toBe('RAW');
});
it('changes ranges, chart type, basis, volume/indicator controls and resets date view without new price requests', async () => {
  const user = userEvent.setup(); mount(); await screen.findByRole('img', { name: 'Test chart' }); const requests = calls.filter(path => path.includes('/prices?')).length;
  await user.click(screen.getByText('3M')); expect(screen.getByRole('radio', { name: '3M' })).toBeChecked(); expect(chart?.from).toBe('2026-01-30');
  await user.click(screen.getByText('Line')); await user.click(screen.getByText('Adjusted')); await user.click(screen.getByRole('checkbox', { name: 'SMA 50' })); await user.click(screen.getByRole('checkbox', { name: 'RSI 14' })); await user.click(screen.getByRole('checkbox', { name: 'Show Volume' }));
  expect(chart?.controls).toMatchObject({ type: 'line', sma50: true, rsi: true, volume: false }); expect(chart?.analysis.rows[0]!.bar?.close).toBe('50'); expect(chart?.analysis.rows[0]!.bar?.volume).toBe('2000');
  await user.clear(screen.getByLabelText('Chart end date')); await user.type(screen.getByLabelText('Chart end date'), '2026-03-31'); await user.click(screen.getByRole('button', { name: 'Reset View' })); expect(chart?.to).toBe('2026-04-30'); expect(calls.filter(path => path.includes('/prices?'))).toHaveLength(requests);
});
it('disables partial adjusted coverage and keeps raw history when adjusted API fails', async () => {
  partial = true; const view = mount(); await screen.findByRole('img', { name: 'Test chart' }); expect(screen.getByRole('radio', { name: 'Adjusted' })).toBeDisabled(); view.unmount();
  partial = false; failure = 'adjusted'; mount(); await screen.findByRole('img', { name: 'Test chart' }); expect(screen.getByText(/Adjusted history unavailable/)).toBeInTheDocument(); expect(chart?.analysis.rows[0]!.bar?.adjustmentMode).toBe('RAW');
});
it('historical date navigation updates every chart metric and excludes future observations', async () => {
  mount(); await screen.findByRole('img', { name: 'Test chart' });
  fireEvent.change(screen.getByLabelText('Chart end date'), { target: { value: '2026-03-31' } });
  expect(chart?.to).toBe('2026-03-31');
  expect(screen.getByText(/2026-01-02 – 2026-03-31/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Chart start date'), { target: { value: '2026-03-02' } });
  expect(chart?.from).toBe('2026-03-02');
  expect(screen.getByText(/2026-03-02 – 2026-03-31/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Chart end date'), { target: { value: '' } });
  expect(screen.getByText(/Choose a valid date window/)).toBeInTheDocument();
});
it('shows short history with unavailable warm-up and gaps, with no fabricated observations', async () => {
  bars = [bars[0]!, bars[2]!]; mount(); await screen.findByRole('img', { name: 'Test chart' }); expect(screen.getAllByText('N/A').length).toBeGreaterThan(5); expect(screen.getByText(/History contains gaps/)).toBeInTheDocument(); expect(chart?.analysis.rows.filter(row => row.bar)).toHaveLength(2);
});
it('handles empty history and price API failures with explicit retry while preserving stock identity', async () => {
  bars = []; const view = mount(); expect(await screen.findByText('No historical OHLCV saved')).toBeInTheDocument(); expect(screen.queryByRole('img', { name: 'Test chart' })).not.toBeInTheDocument(); view.unmount();
  failure = 'prices'; mount(); expect(await screen.findByText('Historical prices unavailable')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Retry Prices' })).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'TEST' })).toBeInTheDocument();
});
it('research marker opens right Drawer and close keeps Price & Volume controls and date window', async () => {
  data.history = [{ id: 'report-1', type: 'AI Report', completedAt: '2026-03-02T15:00:00Z', version: 1, dataCutoff: '2026-02-27T20:00:00Z', fairValue: null }];
  const user = userEvent.setup(); mount(); await screen.findByRole('img', { name: 'Test chart' }); await user.click(screen.getByText('3M')); await user.click(screen.getByText('Line')); await user.click(screen.getByRole('button', { name: 'Select research marker' }));
  const dialog = await screen.findByRole('dialog'); expect(within(dialog).getByText('AI Report · v1')).toBeInTheDocument(); await user.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('tab', { name: 'Price & Volume' })).toHaveAttribute('aria-selected', 'true'); expect(screen.getByRole('radio', { name: '3M' })).toBeChecked(); expect(screen.getByRole('radio', { name: 'Line' })).toBeChecked();
  await user.click(screen.getByRole('tab', { name: 'Overview' })); await user.click(screen.getByRole('tab', { name: 'Price & Volume' })); await waitFor(() => expect(screen.getByRole('radio', { name: 'Line' })).toBeChecked());
});
it('entry zone overlays require matching raw basis/currency and never convert saved assumptions to adjusted prices', async () => {
  data.stock.entryZone = { lower: '90', upper: '95', currency: 'USD', scenarioId: 's1', method: 'User assumption', savedAt: '2026-03-01T15:00:00Z', dataCutoff: '2026-02-27T20:00:00Z', basis: 'TIINGO:DAY:RAW' };
  const user = userEvent.setup(); mount(); await screen.findByRole('img', { name: 'Test chart' }); expect(chart?.entryZone?.lower).toBe('90'); await user.click(screen.getByText('Adjusted')); expect(chart?.entryZone).toBeNull(); expect(screen.getByText(/Chart overlay unavailable/)).toBeInTheDocument();
});
it('events retain actual timestamps and unique saved ordinals across independent research series', () => {
  expect(exchangeDate('2026-03-03T02:00:00Z', 'America/New_York')).toBe('2026-03-02');
  expect(observationAnchor('2026-03-03T02:00:00Z', 'America/New_York')).toBe('2026-03-03');
  const events = chartEvents([{ id: 'f1', form: '8-K', filedDate: '2026-03-02', reportPeriod: '2025-12-31', sourceUrl: 'https://www.sec.gov/test' }], [{ id: 'r1', completedAt: '2026-03-03T02:00:00Z', type: 'AI Report', version: 3, markerOrdinal:7, dataCutoff: '2026-03-01T00:00:00Z', fairValue: null }], 'America/New_York');
  expect(events.map(event => event.date)).toEqual(['2026-03-02', '2026-03-02']); expect(events.find(e => e.kind === 'research')!.label).toBe('R7'); expect(events.some(event => event.kind === 'earnings')).toBe(false);
  expect(chartEvents([],[], 'America/New_York')).toEqual([]);
});
