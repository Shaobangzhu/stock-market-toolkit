import { useEffect, useRef } from 'react';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import type { StockOverview } from '../../api/stocks';
use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
export function PricePerformanceChart({ performance }: { performance: StockOverview['performance'] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || !performance.points.length) return;
    const chart = init(container.current, undefined, { renderer: 'canvas' });
    const option: EChartsCoreOption = {
      backgroundColor: 'transparent', animation: false,
      tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: '#102238', borderColor: '#29405e', textStyle: { color: '#eaf3ff' } },
      grid: { left: 62, right: 18, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: performance.points.map(row => row.tradingDate), axisLabel: { color: '#8ba3bf', hideOverlap: true }, axisLine: { lineStyle: { color: '#28405d' } } },
      yAxis: { type: 'value', scale: true, axisLabel: { color: '#8ba3bf' }, splitLine: { lineStyle: { color: '#1e3046' } } },
      series: [{ name: 'Historical close', type: 'line', showSymbol: false, connectNulls: false, smooth: false,
        data: performance.points.map(row => { const value = row.close === null ? null : Number(row.close); return value !== null && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER ? value : null; }),
        lineStyle: { color: '#168cff', width: 2 }, itemStyle: { color: '#168cff' }, areaStyle: { color: '#087fff', opacity: 0.09 } }],
    };
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [performance]);
  return <div ref={container} className="price-performance-chart" role="img" aria-label="Historical price performance chart" />;
}
