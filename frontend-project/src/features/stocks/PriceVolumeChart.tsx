import { useEffect, useRef } from 'react';
import { BarChart, CandlestickChart, LineChart, ScatterChart } from 'echarts/charts';
import { AxisPointerComponent, DataZoomComponent, GridComponent, MarkAreaComponent, TooltipComponent } from 'echarts/components';
import { init, use, type EChartsCoreOption } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { chartNumber } from '../../api/prices';
import type { Analysis } from './technical-analysis';
import { observationAnchor, type ChartEventMarker } from './chart-events';
import type { ChartControls } from './chart-controls';

use([BarChart, CandlestickChart, LineChart, ScatterChart, AxisPointerComponent, DataZoomComponent, GridComponent, MarkAreaComponent, TooltipComponent, CanvasRenderer]);
export interface PriceVolumeChartProps {
  analysis: Analysis; from: string | null; to: string; controls: ChartControls; events: ChartEventMarker[];
  entryZone: { lower: string; upper: string; savedAt: string } | null; reset: number;
  onEvent: (event: ChartEventMarker) => void;
}
export function buildChartOption(props: PriceVolumeChartProps, zoom = { start: 0, end: 100 }): EChartsCoreOption {
  const { analysis, from, to, controls, events, entryZone } = props;
  const indices = analysis.rows.map((_, i) => i).filter(i => { const row = analysis.rows[i]!; return row.bar ? (!from || row.bar.tradingDate >= from) && row.bar.tradingDate <= to : i > 0 && analysis.rows[i - 1]!.bar !== null && (!from || analysis.rows[i - 1]!.bar!.tradingDate >= from) && analysis.rows[i - 1]!.bar!.tradingDate < to; });
  const rows = indices.map(i => analysis.rows[i]!);
  const dates = rows.map(row => row.date);
  const timezone = rows.find(row => row.bar)?.bar?.exchangeTimezone ?? 'America/New_York';
  const savedAnchor = entryZone ? observationAnchor(entryZone.savedAt, timezone) : null;
  const select = (values: (number | null)[]) => indices.map(i => values[i] ?? null);
  const subpanels = [controls.volume && 'volume', controls.rsi && 'rsi', controls.macd && 'macd'].filter(Boolean) as string[];
  const grids = [{ left: 60, right: 20, top: 30, height: subpanels.length ? '44%' : '78%' }, ...subpanels.map((_, i) => ({ left: 60, right: 20, top: `${49 + i * (36 / subpanels.length)}%`, height: `${29 / subpanels.length}%` }))];
  const axes = grids.map((_, i) => ({ type: 'category', gridIndex: i, data: dates, boundaryGap: true, axisLine: { lineStyle: { color: '#29415d' } }, axisTick: { show: false }, axisLabel: { color: '#8da7c4', show: i === grids.length - 1, hideOverlap: true }, axisPointer: { show: true } }));
  const priceData = rows.map(row => row.bar ? [chartNumber(row.bar.open), chartNumber(row.bar.close), chartNumber(row.bar.low), chartNumber(row.bar.high)] : ['-', '-', '-', '-']);
  const base = { name: controls.type === 'candlestick' ? 'Daily OHLC' : 'Close', type: controls.type, xAxisIndex: 0, yAxisIndex: 0,
    data: controls.type === 'candlestick' ? priceData : rows.map(row => row.bar ? chartNumber(row.bar.close) : null),
    ...(controls.type === 'candlestick' ? { itemStyle: { color: '#14c993', color0: '#f76372', borderColor: '#14c993', borderColor0: '#f76372' } } : { showSymbol: false, connectNulls: false, lineStyle: { color: '#168cff', width: 2 }, itemStyle: { color: '#168cff' } }),
    ...(entryZone && savedAnchor && rows.some(row => row.bar && row.bar.tradingDate >= savedAnchor) ? { markArea: { silent: true, itemStyle: { color: 'rgba(22,140,255,0.10)', borderColor: '#398adb', borderWidth: 1 }, label: { color: '#89bfff', position: 'insideTopLeft', formatter: 'Saved entry zone' }, data: [[{ xAxis: rows.find(row => row.bar && row.bar.tradingDate >= savedAnchor)?.date, yAxis: chartNumber(entryZone.lower) }, { xAxis: dates.at(-1), yAxis: chartNumber(entryZone.upper) }]] } } : {}),
  };
  const series: Record<string, unknown>[] = [base];
  function line(name: string, data: (number | null)[], color: string, axis = 0) { series.push({ name, type: 'line', xAxisIndex: axis, yAxisIndex: axis, showSymbol: false, connectNulls: false, data: select(data), lineStyle: { color, width: 1.3 }, itemStyle: { color } }); }
  if (controls.sma50) line('SMA 50', analysis.sma50, '#e6b668');
  if (controls.sma200) line('SMA 200', analysis.sma200, '#ab93ee');
  if (controls.ema20) line('EMA 20', analysis.ema20, '#63c5ea');
  if (controls.bollinger) { line('BB upper', analysis.bands.upper, '#8ba8cc'); line('BB middle', analysis.bands.middle, '#61789b'); line('BB lower', analysis.bands.lower, '#8ba8cc'); }
  subpanels.forEach((panel, n) => {
    const axis = n + 1;
    if (panel === 'volume') series.push({ name: 'Volume', type: 'bar', xAxisIndex: axis, yAxisIndex: axis, barMaxWidth: 14, data: rows.map(row => row.bar ? { value: chartNumber(row.bar.volume), itemStyle: { color: chartNumber(row.bar.close) >= chartNumber(row.bar.open) ? '#259779' : '#b84b60' } } : null) });
    if (panel === 'rsi') line('RSI 14', analysis.rsi, '#a996ed', axis);
    if (panel === 'macd') { line('MACD', analysis.macd.line, '#56a7ff', axis); line('Signal', analysis.macd.signal, '#e0b063', axis); series.push({ name: 'MACD histogram', type: 'bar', xAxisIndex: axis, yAxisIndex: axis, data: select(analysis.macd.histogram).map(value => value === null ? null : { value, itemStyle: { color: value >= 0 ? '#259779' : '#b84b60' } }) }); }
  });
  const eventRows = events.map(event => {
    const anchor = event.occurredAt ? observationAnchor(event.occurredAt, timezone) : event.date;
    const rowIndex = rows.findIndex(row => row.bar && row.bar.tradingDate >= anchor);
    if (rowIndex < 0 || !rows.some(row => row.bar && row.bar.tradingDate <= event.date)) return null;
    const row = rows[rowIndex]!, high = chartNumber(row.bar!.high);
    return { name: event.label, value: [row.date, high * 1.04], event, symbolOffset: [0, event.kind === 'research' ? -20 : 0] };
  }).filter(Boolean);
  series.push({ name: 'Events', type: 'scatter', xAxisIndex: 0, yAxisIndex: 0, symbol: 'roundRect', symbolSize: [40, 21], data: eventRows, itemStyle: { color: '#164975', borderColor: '#5598d0', borderWidth: 1 }, label: { show: true, formatter: '{b}', color: '#e3f0ff', fontSize: 10 }, z: 10 });
  return {
    animation: false, backgroundColor: 'transparent', grid: grids,
    axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: '#28496a' } },
    tooltip: { trigger: 'axis', renderMode: 'richText', axisPointer: { type: 'cross' }, backgroundColor: '#102238', borderColor: '#2b4666', textStyle: { color: '#e9f2ff' },
      formatter: (input: unknown) => { const items = Array.isArray(input) ? input : [input]; const first = items.find(item => (item as { seriesName?: string }).seriesName !== 'Events') as { dataIndex?: number } | undefined; const row = rows[first?.dataIndex ?? -1]; if (!row?.bar) return 'No observation / basis break'; const b = row.bar; return `${b.tradingDate} · ${b.currency} · ${b.adjustmentMode}\nOpen ${b.open}   High ${b.high}\nLow ${b.low}   Close ${b.close}\nVolume ${b.volume}\n${b.provider} · ${b.exchangeTimezone}`; } },
    xAxis: axes,
    yAxis: grids.map((_, i) => ({ type: 'value', gridIndex: i, name: i === 0 ? 'Price' : subpanels[i - 1] === 'volume' ? 'Volume' : subpanels[i - 1]?.toUpperCase(), nameTextStyle: { color: '#8da7c4', fontSize: 10 }, scale: i === 0, ...(subpanels[i - 1] === 'rsi' ? { min: 0, max: 100 } : {}), axisLabel: { color: '#8da7c4', hideOverlap: true }, splitLine: { lineStyle: { color: '#1c324b' } } })),
    dataZoom: [{ type: 'inside', xAxisIndex: axes.map((_, i) => i), filterMode: 'none', zoomOnMouseWheel: true, moveOnMouseMove: true, ...zoom }, { type: 'slider', xAxisIndex: axes.map((_, i) => i), filterMode: 'none', bottom: 8, height: 22, borderColor: '#29415d', textStyle: { color: '#8da7c4' }, ...zoom }], series,
  };
}
export function PriceVolumeChart(props: PriceVolumeChartProps) {
  const container = useRef<HTMLDivElement>(null), chart = useRef<ReturnType<typeof init> | null>(null);
  const zoom = useRef({ start: 0, end: 100 }), current = useRef(props), priorWindow = useRef(''); current.current = props;
  useEffect(() => {
    if (!container.current) return;
    const instance = init(container.current, undefined, { renderer: 'canvas' }); chart.current = instance;
    instance.on('datazoom', (event: unknown) => { const e = event as { start?: number; end?: number; batch?: { start: number; end: number }[] }; const z = e.batch?.[0] ?? e; if (typeof z.start === 'number' && typeof z.end === 'number') zoom.current = { start: z.start, end: z.end }; });
    instance.on('click', (event: unknown) => { const e = event as { data?: { event?: ChartEventMarker } }; if (e.data?.event) current.current.onEvent(e.data.event); });
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); instance.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    const window = `${props.from}:${props.to}:${props.reset}`;
    if (window !== priorWindow.current) { zoom.current = { start: 0, end: 100 }; priorWindow.current = window; }
    chart.current?.setOption(buildChartOption(props, zoom.current), { notMerge: true });
  }, [props]);
  return <div ref={container} className="technical-price-chart" style={{ minHeight: 500 + (Number(props.controls.rsi) + Number(props.controls.macd)) * 90 }} role="img" aria-label="Daily OHLCV chart with linked volume, crosshair, zoom and event markers" />;
}
