import { useEffect, useRef } from 'react';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { formatFinancialValue } from '../../utils/format';

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

export interface PriceVolumeBar {
  tradingDate: string;
  close: string;
  volume: string;
  currency: string;
  provider: string;
  adjustmentMode: string;
}

function displayNumber(value: string): number | null {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
}

export function PriceVolumeChart({ bars }: { bars: readonly PriceVolumeBar[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current || bars.length === 0) return;
    const chart = init(container.current, undefined, { renderer: 'canvas' });
    const option: EChartsCoreOption = {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: { trigger: 'axis', backgroundColor: '#102238', borderColor: '#29405e', textStyle: { color: '#eaf3ff' } },
      legend: { data: ['Close', 'Volume'], textStyle: { color: '#a5b5c9' }, top: 0 },
      grid: { left: 64, right: 64, top: 48, bottom: 48 },
      xAxis: { type: 'category', data: bars.map((bar) => bar.tradingDate), axisLabel: { color: '#889cb8' }, axisLine: { lineStyle: { color: '#28405d' } } },
      yAxis: [
        { type: 'value', scale: true, axisLabel: { color: '#889cb8' }, splitLine: { lineStyle: { color: '#1e3046' } } },
        { type: 'value', axisLabel: { color: '#889cb8' }, splitLine: { show: false } },
      ],
      series: [
        { name: 'Close', type: 'line', smooth: false, showSymbol: false, connectNulls: false, data: bars.map((bar) => displayNumber(bar.close)), lineStyle: { color: '#4a8dff', width: 2 }, itemStyle: { color: '#4a8dff' } },
        { name: 'Volume', type: 'bar', yAxisIndex: 1, data: bars.map((bar) => displayNumber(bar.volume)), itemStyle: { color: '#31577f' }, barMaxWidth: 18 },
      ],
    };
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [bars]);

  if (bars.length === 0) return null;
  const latest = bars[bars.length - 1];
  return (
    <div className="price-volume-chart">
      <div ref={container} role="img" aria-label="Historical closing price and trading volume chart" />
      {latest && <p className="chart-caption">Latest stored close: {formatFinancialValue(latest.close, latest.currency)} · {latest.tradingDate} · {latest.provider} · {latest.adjustmentMode}</p>}
    </div>
  );
}
