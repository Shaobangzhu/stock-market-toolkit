import { lazy, Suspense, useId, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Radio } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { PRICE_RANGES, researchQuery, safeOfficialUrl, type PriceRange, type ResearchRecord, type StockOverview } from '../../api/stocks';
import { isTradingDate, pricesQuery, type CachedPrices, type PriceBasis } from '../../api/prices';
import { filingsQuery } from '../../api/stocks';
import { requestError } from '../../api/watchlist';
import { EmptyState, LoadingState } from '../../components/States';
import { formatFinancialValue } from '../../utils/format';
import { OverviewPanel } from './OverviewSections';
import { DEFAULT_CHART_CONTROLS, type ChartControls } from './chart-controls';
import { analyzeHistory, rangeStart, supportedRange, technicalMetrics } from './technical-analysis';
import { chartEvents, type ChartEventMarker } from './chart-events';

const Chart = lazy(() => import('./PriceVolumeChart').then(module => ({ default: module.PriceVolumeChart })));
const display = (value: number | null, suffix = '') => value === null || !Number.isFinite(value) ? 'N/A' : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}${suffix}`;
const INDICATORS = { sma50: 'SMA 50', sma200: 'SMA 200', ema20: 'EMA 20', bollinger: 'Bollinger Bands (20, 2)', rsi: 'RSI 14', macd: 'MACD 12/26/9' } as const;
function CachedWorkspace({ data, cache, records, events, onResearch }: { data: StockOverview; cache: CachedPrices; records: ResearchRecord[]; events: ChartEventMarker[]; onResearch: (record: ResearchRecord) => void }) {
  const controlId = useId();
  const [basis, setBasis] = useState<PriceBasis>('RAW'), [requestedRange, setRange] = useState<PriceRange>('1Y');
  const [controls, setControls] = useState<ChartControls>({ ...DEFAULT_CHART_CONTROLS }), [reset, setReset] = useState(0);
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null), [selectedEvent, setSelectedEvent] = useState<ChartEventMarker | null>(null);
  const raw = cache.raw.bars;
  const adjustedByDate = useMemo(() => new Map(cache.adjusted?.bars.map(bar => [bar.tradingDate, bar]) ?? []), [cache.adjusted]);
  const adjustedSupported = raw.length > 0 && raw.every(bar => adjustedByDate.has(bar.tradingDate));
  const activeBasis = basis === 'TOTAL_RETURN' && adjustedSupported ? basis : 'RAW';
  const bars = useMemo(() => activeBasis === 'RAW' ? raw : raw.map(bar => adjustedByDate.get(bar.tradingDate)!), [activeBasis, raw, adjustedByDate]);
  const analysis = useMemo(() => analyzeHistory(bars, data.stock.exchange), [bars, data.stock.exchange]);
  const range = supportedRange(bars, requestedRange) ? requestedRange : 'MAX';
  const latest = bars.at(-1)?.tradingDate ?? '', earliest = bars[0]?.tradingDate ?? '';
  const requestedFrom = latest ? rangeStart(latest, range) : null;
  const defaultFrom = requestedFrom && requestedFrom < earliest ? earliest : requestedFrom;
  const from = dates?.from ?? defaultFrom, to = dates?.to ?? latest;
  const validWindow = !!latest && (from === null || isTradingDate(from)) && isTradingDate(to) && (!from || (from <= to && from >= earliest)) && to <= latest && to >= earliest;
  const metrics = useMemo(() => technicalMetrics(bars, from, to, data.stock.exchange, analysis), [bars, from, to, data.stock.exchange, analysis]);
  const rowsThrough = analysis.rows.filter(row => row.bar && row.bar.tradingDate <= to);
  const endIndex = rowsThrough.at(-1)?.index;
  const metricCurrency = cache.raw.instrument.currency;
  const entry = data.stock.entryZone;
  const zoneCompatible = entry && activeBasis === 'RAW' && entry.currency === metricCurrency && entry.basis === 'TIINGO:DAY:RAW' ? entry : null;
  function chooseEvent(event: ChartEventMarker) { setSelectedEvent(event); if (event.researchId) { const record = records.find(record => record.id === event.researchId); if (record) onResearch(record); } }
  const stats: [string, string][] = [
    ['52W High', metrics.high52 === null ? 'N/A' : formatFinancialValue(String(metrics.high52), metricCurrency)],
    ['52W Low', metrics.low52 === null ? 'N/A' : formatFinancialValue(String(metrics.low52), metricCurrency)],
    ['Average Volume', display(metrics.averageVolume)], ['30D Historical Volatility', display(metrics.volatility30, '%')],
    ['Maximum Drawdown', display(metrics.drawdown, '%')], ['Selected Period Return', display(metrics.periodReturn, '%')],
    ['RSI 14', display(metrics.rsi)], ['MACD 12/26/9', display(metrics.macd)], ['MACD Signal', display(metrics.macdSignal)],
  ];
  // Last indicator at the selected date, using only that date and earlier inputs.
  const analysisIndex = endIndex === undefined ? -1 : analysis.rows.findIndex(row => row.index === endIndex);
  return <div className="price-volume-workspace">
    <div className="price-volume-main">
      <OverviewPanel title="Price & Volume" action={<Radio.Group name={`${controlId}-range`} aria-label="Historical time range" value={range} onChange={event => { setRange(event.target.value as PriceRange); setDates(null); }}>
        {PRICE_RANGES.map(value => <Radio.Button key={value} value={value} disabled={!supportedRange(bars, value)} title={!supportedRange(bars, value) ? 'Insufficient cached history for this range' : undefined}>{value}</Radio.Button>)}
      </Radio.Group>}>
        <div className="chart-provenance"><strong>TIINGO · Daily EOD · {activeBasis === 'RAW' ? 'Raw prices / raw shares' : 'Total-return adjusted prices / adjusted shares'}</strong><span>{metricCurrency} · {cache.raw.instrument.exchangeTimezone}</span></div>
        {cache.adjustedUnavailable && <Alert type="warning" title="Adjusted history unavailable; raw cache remains available." />}
        {!adjustedSupported && raw.length > 0 && !cache.adjustedUnavailable && <p>Adjusted mode requires matching OHLCV for every cached raw observation.</p>}
        {analysis.rows.some(row => !row.bar) && <Alert type="warning" title="History contains gaps or raw share-basis breaks" description="No candles are fabricated. Indicators restart after each break; non-comparable returns are N/A." />}
        {raw.some(row => !row.tradingDate.startsWith('2026-')) && <p>Exchange calendar coverage outside 2026 is unverified. Calculations use stored observations; 30D daily volatility requires verified consecutive sessions.</p>}
        <div className="chart-date-navigation">
          <label>From<input type="date" aria-label="Chart start date" value={dates?.from ?? defaultFrom ?? earliest} min={earliest} max={to} onChange={event => setDates({ from: event.target.value, to })} /></label>
          <label>Through<input type="date" aria-label="Chart end date" value={to} min={dates?.from ?? defaultFrom ?? earliest} max={latest} onChange={event => setDates({ from: from ?? earliest, to: event.target.value })} /></label>
          <Button onClick={() => { setDates(null); setReset(v => v + 1); }}>Reset View</Button>
        </div>
        {!raw.length ? <EmptyState title="No historical OHLCV saved" description="Use Sync Data in the stock header to explicitly import Tiingo daily history." /> : !validWindow ? <Alert type="warning" title="Choose a valid date window within cached history." /> : !metrics.observations ? <EmptyState title="No observations in this date window" description="Choose dates with cached trading sessions." /> : <>
          <Suspense fallback={<LoadingState label="Loading chart" />}><Chart analysis={analysis} from={from} to={to} controls={controls} events={events} entryZone={zoneCompatible} reset={reset} onEvent={chooseEvent} /></Suspense>
          <p className="chart-caption">{metrics.firstDate} – {metrics.lastDate} · {metrics.observations} stored observations. Scroll to zoom, drag to pan, or use the date slider. Metrics refer to the chosen date window, independent of slider zoom.</p>
        </>}
      </OverviewPanel>
      <OverviewPanel title="Technical Indicators">
        <div className="technical-metric-grid">{stats.map(([label, value]) => <div className="technical-metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        <p>{metrics.fullYear ? '52-week observed high/low.' : '52-week high/low reflect partial stored coverage.'} All metrics use {activeBasis}. Average volume uses the selected series’ shares. N/A indicates insufficient or non-comparable inputs.</p>
        <p>30D volatility = sample SD of 30 daily log returns × √252 × 100. Drawdown and return use observed closes. Indicators are descriptive calculations, without trading recommendations.</p>
      </OverviewPanel>
    </div>
    <aside className="price-volume-side">
      <OverviewPanel title="Chart Controls">
        <label className="chart-control-label">Chart type</label><Radio.Group name={`${controlId}-type`} aria-label="Chart type" value={controls.type} onChange={event => setControls(v => ({ ...v, type: event.target.value }))}><Radio.Button value="candlestick">Candlestick</Radio.Button><Radio.Button value="line">Line</Radio.Button></Radio.Group>
        <label className="chart-control-label">Price adjustment</label><Radio.Group name={`${controlId}-basis`} aria-label="Price adjustment" value={activeBasis} onChange={event => { setBasis(event.target.value); setReset(v => v + 1); }}><Radio.Button value="RAW">Raw</Radio.Button><Radio.Button value="TOTAL_RETURN" disabled={!adjustedSupported}>Adjusted</Radio.Button></Radio.Group>
        <div className="chart-indicator-controls">{Object.entries(INDICATORS).map(([key, label]) => <Checkbox key={key} checked={controls[key as keyof typeof INDICATORS]} onChange={event => setControls(v => ({ ...v, [key]: event.target.checked }))}>{label}</Checkbox>)}<Checkbox checked={controls.volume} onChange={event => setControls(v => ({ ...v, volume: event.target.checked }))}>Show Volume</Checkbox></div>
        <div className="indicator-readings">{[['SMA 50', analysis.sma50], ['SMA 200', analysis.sma200], ['EMA 20', analysis.ema20], ['BB Upper', analysis.bands.upper], ['BB Lower', analysis.bands.lower]].map(([name, values]) => <div key={name as string}><span>{name as string}</span><strong>{display((values as (number | null)[])[analysisIndex] ?? null)}</strong></div>)}</div>
        <p>Warm-up: SMA 50/200 requires 50/200 closes; EMA 20 and bands require 20; RSI requires 15; MACD signal requires 34.</p>
      </OverviewPanel>
      <OverviewPanel title="Recent Events">
        {!events.length ? <p>No verified events or saved research reports available.</p> : <div className="chart-event-list">{events.slice(0, 10).map(event => { const url = safeOfficialUrl(event.sourceUrl); return <div className={selectedEvent?.id === event.id ? 'chart-event selected' : 'chart-event'} key={event.id}><Button type="text" onClick={() => chooseEvent(event)}>{event.label} · {event.date}</Button><span>{event.title}</span>{url && <a href={url} target="_blank" rel="noreferrer">Official filing</a>}<small>{event.provenance}</small></div>; })}</div>}
        <p>Latest 200 stored filings and 50 completed reports. Non-trading dates attach to the next stored session, retaining the original publication date. Earnings are shown only when verified evidence is available.</p>
      </OverviewPanel>
      <OverviewPanel title="Entry Zone">
        {!entry ? <p>No valuation scenario saved yet.</p> : <><strong>{formatFinancialValue(entry.lower, entry.currency)} – {formatFinancialValue(entry.upper, entry.currency)}</strong><p>Saved scenario · {entry.method} · {entry.savedAt.slice(0, 10)}</p><p>{zoneCompatible ? 'Blue chart band shows this saved assumption from its saved date onward.' : 'Chart overlay unavailable: saved zone and chart must share raw price basis and currency.'}</p><p>Distance to entry: {data.stock.distanceToEntry === null ? 'N/A' : `${data.stock.distanceToEntry}%`} (latest stored raw close).</p></>}
      </OverviewPanel>
    </aside>
  </div>;
}
export function PriceVolumeWorkspace({ data, active, onResearch }: { data: StockOverview; active: boolean; onResearch: (record: ResearchRecord) => void }) {
  const prices = useQuery(pricesQuery(data.stock.symbol, data.stock.exchange, data.asOf.slice(0, 10), active));
  const filings = useQuery({ ...filingsQuery(data.stock.symbol, 200), enabled: active });
  const reports = useQuery(researchQuery(data.stock.symbol, active));
  const events = useMemo(() => chartEvents(filings.data?.filings ?? [], reports.data ?? data.history, prices.data?.raw.instrument.exchangeTimezone ?? 'America/New_York'), [filings.data, reports.data, data.history, prices.data]);
  if (!prices.data) return prices.isError ? <OverviewPanel title="Price & Volume"><Alert type="error" title="Historical prices unavailable" description={prices.error instanceof Error && !(prices.error.name === 'ApiError') ? prices.error.message : requestError(prices.error)} /><Button onClick={() => void prices.refetch()}>Retry Prices</Button></OverviewPanel> : <LoadingState label="Loading cached OHLCV history" />;
  return <>
    {prices.isError && <Alert type="warning" title="Price refresh failed; showing previous cache." />}
    {(filings.isError || reports.isError) && <Alert type="warning" title="Some event data could not be refreshed" description="Available prices and previously loaded events remain readable." />}
    <CachedWorkspace data={data} cache={prices.data} records={reports.data ?? data.history} events={events} onResearch={onResearch} />
  </>;
}
