import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const { init, use } = vi.hoisted(() => ({ init: vi.fn(), use: vi.fn() }));
vi.mock('echarts/core', () => ({ init, use }));

import { PriceVolumeChart } from './PriceVolumeChart';

afterEach(() => { init.mockReset(); use.mockClear(); });

it('initializes, resizes, and disposes the ECharts instance with its React lifecycle', () => {
  const setOption = vi.fn();
  const resize = vi.fn();
  const dispose = vi.fn();
  init.mockReturnValue({ setOption, resize, dispose });
  class TestResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() { this.callback([], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  const bars = [{ tradingDate: '2026-01-02', close: '100.25', volume: '1200', currency: 'USD', provider: 'TIINGO', adjustmentMode: 'RAW' }];
  const view = render(<PriceVolumeChart bars={bars} />);
  expect(screen.getByRole('img', { name: 'Historical closing price and trading volume chart' })).toBeInTheDocument();
  expect(setOption).toHaveBeenCalledOnce();
  expect(resize).toHaveBeenCalledOnce();
  expect(screen.getByText(/\$100.25/)).toBeInTheDocument();
  view.unmount();
  expect(dispose).toHaveBeenCalledOnce();
});
