import { StrictMode } from 'react';
import { expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from './Sparkline';
const chart = vi.hoisted(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }));
const init = vi.hoisted(() => vi.fn(() => chart));
vi.mock('echarts/core', () => ({ init, use: vi.fn() }));
it('plots supplied API observations only and disposes ECharts under StrictMode', () => {
  const { unmount } = render(<StrictMode><Sparkline points={[{ tradingDate: '2026-01-05', close: '10' }, { tradingDate: '2026-01-06', close: '11' }]} /></StrictMode>);
  expect(chart.setOption).toHaveBeenCalledWith(expect.objectContaining({ series: [expect.objectContaining({ data: [10, 11], connectNulls: false })] }));
  unmount(); expect(chart.dispose.mock.calls.length).toBe(init.mock.calls.length);
});
