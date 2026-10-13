import { useEffect, useRef } from 'react';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
export function Sparkline({ points }: { points: { tradingDate: string; close: string }[] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current || !points.length) return;
    const chart = init(container.current, undefined, { renderer: 'canvas' });
    chart.setOption({ animation: false, grid: { left: 2, right: 2, top: 8, bottom: 4 },
      tooltip: { trigger: 'axis', renderMode: 'richText', backgroundColor: '#102238', borderColor: '#29405e', textStyle: { color: '#eaf3ff' } },
      xAxis: { type: 'category', data: points.map(p => p.tradingDate), show: false }, yAxis: { type: 'value', scale: true, show: false },
      series: [{ type: 'line', data: points.map(p => { const value = Number(p.close); return Number.isFinite(value) && value <= Number.MAX_SAFE_INTEGER ? value : null; }),
        showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2, color: '#4a9aff' }, areaStyle: { color: 'rgba(74,154,255,.12)' } }] });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [points]);
  return points.length ? <div ref={container} className="watchlist-sparkline" role="img" aria-label="Last 60 stored daily closing prices" /> : <div className="sparkline-empty">No price history imported</div>;
}
