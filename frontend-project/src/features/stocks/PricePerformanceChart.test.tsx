import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
const { init } = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('echarts/core', () => ({ init, use: vi.fn() }));
import { PricePerformanceChart } from './PricePerformanceChart';
import { overviewFixture } from './StockResearch.fixtures';
it('ECharts preserves gaps and safely resizes/disposes across StrictMode remounts', () => {
  const instances: { setOption: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn> }[] = [];
  init.mockImplementation(() => { const chart = { setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() }; instances.push(chart); return chart; });
  const performance = overviewFixture().performance; performance.points.splice(1, 0, { tradingDate: 'Gap', close: null });
  const view = render(<StrictMode><PricePerformanceChart performance={performance} /></StrictMode>);
  expect(screen.getByRole('img', { name: 'Historical price performance chart' })).toBeInTheDocument();
  expect(instances[0]!.setOption.mock.calls[0]![0].series[0].data).toEqual([5, null, 5.5, 6]);
  expect(instances[0]!.setOption.mock.calls[0]![0].series[0].connectNulls).toBe(false);
  view.unmount(); expect(instances).toHaveLength(2); expect(instances.every(instance => instance.dispose.mock.calls.length === 1)).toBe(true);
});
