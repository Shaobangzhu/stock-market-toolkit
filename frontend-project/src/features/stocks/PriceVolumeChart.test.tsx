import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('echarts/core', () => ({ init, use: vi.fn() }));
import { PriceVolumeChart, buildChartOption, type PriceVolumeChartProps } from './PriceVolumeChart';
import { DEFAULT_CHART_CONTROLS } from './chart-controls';
import { analyzeHistory } from './technical-analysis';
import { dailyBar } from './PriceVolume.fixtures';
const props = (): PriceVolumeChartProps => ({ analysis: analyzeHistory([dailyBar('2026-01-05'), dailyBar('2026-01-07', 101)], 'NASDAQ'), from: null, to: '2026-01-07', controls: { ...DEFAULT_CHART_CONTROLS }, events: [{ id: 'report-1', kind: 'research', label: 'R1', title: 'Saved report', date: '2026-01-07', researchId: 'report-1', provenance: 'Saved report' }], entryZone: null, reset: 0, onEvent: vi.fn() });
afterEach(() => init.mockReset());
it('uses ECharts OHLC ordering and perfectly aligns price/volume axes without fake candles', () => {
  const option = buildChartOption(props()) as any;
  expect(option.series[0].type).toBe('candlestick');
  expect(option.series[0].data).toEqual([[99.5, 100, 99, 101], ['-', '-', '-', '-'], [100.5, 101, 100, 102]]);
  expect(option.series[1].data.map((v: any) => v?.value ?? null)).toEqual([1000, null, 1000]);
  expect(option.xAxis[0].data).toEqual(option.xAxis[1].data); expect(option.axisPointer.link).toEqual([{ xAxisIndex: 'all' }]);
  expect(option.dataZoom[0].xAxisIndex).toEqual([0, 1]); expect(option.tooltip.formatter([{ dataIndex: 2 }])).toContain('Open 100.5');
});
it('shows independent RSI/MACD panels, line breaks and compatible saved entry bands without backcasting', () => {
  const p = props(); p.controls = { ...p.controls, type: 'line', rsi: true, macd: true, bollinger: true }; p.entryZone = { lower: '90', upper: '95', savedAt: '2026-01-07T12:00:00Z' };
  const option = buildChartOption(p) as any;
  expect(option.grid).toHaveLength(4); expect(option.series[0].data).toEqual([100, null, 101]); expect(option.series[0].markArea.data[0][0].xAxis).toBe('2026-01-07'); expect(option.series.some((s: any) => s.name === 'MACD histogram')).toBe(true);
  p.entryZone.savedAt = '2026-01-08T12:00:00Z'; expect((buildChartOption(p) as any).series[0].markArea).toBeUndefined();
});
it('resizes/disposes under StrictMode, dispatches marker interaction, preserves zoom on controls and resets it explicitly', () => {
  const instances: any[] = [];
  init.mockImplementation(() => { const callbacks: Record<string, (v: any) => void> = {}; const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn((name: string, callback: (v: any) => void) => { callbacks[name] = callback; }), callbacks }; instances.push(instance); return instance; });
  class Observer { constructor(private callback: ResizeObserverCallback) {} observe() { this.callback([], this as unknown as ResizeObserver); } disconnect() {} }
  vi.stubGlobal('ResizeObserver', Observer);
  const p = props(), view = render(<StrictMode><PriceVolumeChart {...p} /></StrictMode>), instance = instances.at(-1);
  expect(screen.getByRole('img', { name: /Daily OHLCV chart/ })).toBeInTheDocument(); expect(instance.resize).toHaveBeenCalled();
  instance.callbacks.click({ data: { event: p.events[0] } }); expect(p.onEvent).toHaveBeenCalledWith(p.events[0]);
  instance.callbacks.datazoom({ start: 25, end: 80 });
  view.rerender(<StrictMode><PriceVolumeChart {...p} controls={{ ...p.controls, rsi: true }} /></StrictMode>);
  expect(instance.setOption.mock.calls.at(-1)[0].dataZoom[0].start).toBe(25);
  view.rerender(<StrictMode><PriceVolumeChart {...p} reset={1} /></StrictMode>); expect(instance.setOption.mock.calls.at(-1)[0].dataZoom[0].start).toBe(0);
  view.unmount(); expect(instances).toHaveLength(2); expect(instances.every(i => i.dispose.mock.calls.length === 1)).toBe(true);
});
