import { lazy, Suspense } from 'react';
import { Button, Tabs } from 'antd';
import { ArrowRightOutlined, BookOutlined, FileTextOutlined, FundOutlined, HistoryOutlined } from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import { StockHeader } from '../../components/StockHeader';
import { MetricCard } from '../../components/MetricCard';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { ResearchHistoryDrawer } from '../../components/ResearchHistoryDrawer';
import type { PriceVolumeBar } from './PriceVolumeChart';

const PriceVolumeChart = lazy(async () => ({ default: (await import('./PriceVolumeChart')).PriceVolumeChart }));

function Overview({ onOpenHistory }: { onOpenHistory: () => void }) {
  return (
    <div className="stock-overview">
      <div className="metric-grid stock-metrics">
        <MetricCard label="LATEST CLOSE" value="—" detail="No closing price stored" icon={<FundOutlined />} />
        <MetricCard label="MARKET DATA" value="—" detail="Provider and date unavailable" />
        <MetricCard label="ENTRY SCENARIO" value="—" detail="No approved method or saved inputs" />
      </div>
      <div className="stock-overview__grid">
        <section className="panel insight-panel" aria-labelledby="overview-title">
          <div className="panel__header"><div><span className="eyebrow">COMPANY CONTEXT</span><h2 id="overview-title">Overview</h2></div><FundOutlined /></div>
          <EmptyState title="Research begins with evidence" description="Company details, SEC filings, and fundamentals will appear here once their data services are connected." />
        </section>
        <div className="stock-overview__side">
          <section className="panel research-panel" aria-labelledby="history-title">
            <div className="panel__header"><div><span className="eyebrow">SAVED WORK</span><h2 id="history-title">Research History</h2></div><HistoryOutlined /></div>
            <p>Review sourced research alongside this stock. No reports are stored yet.</p>
            <Button onClick={onOpenHistory} icon={<ArrowRightOutlined />}>Open history</Button>
          </section>
          <section className="panel source-panel" aria-labelledby="filings-title">
            <div className="panel__header"><div><span className="eyebrow">PRIMARY SOURCES</span><h2 id="filings-title">SEC filings</h2></div><FileTextOutlined /></div>
            <p>Filing dates, reporting periods, and source links will live here.</p>
            <span className="source-panel__status"><BookOutlined /> No filings loaded</span>
          </section>
        </div>
      </div>
    </div>
  );
}

function PriceVolume() {
  // The chart accepts typed, provider-labelled bars; data fetching follows with the market API.
  const bars: PriceVolumeBar[] = [];
  return (
    <section className="panel price-panel" aria-labelledby="price-title">
      <div className="panel__header"><div><span className="eyebrow">HISTORICAL DATA</span><h2 id="price-title">Price &amp; Volume</h2></div><span className="panel__minor">Daily bars · provider and adjustment shown with data</span></div>
      {bars.length > 0 ? <Suspense fallback={<LoadingState label="Loading chart" />}><PriceVolumeChart bars={bars} /></Suspense> : (
        <EmptyState title="No price history yet" description="Historical daily prices and volume will appear after an explicit data import is available." />
      )}
    </section>
  );
}

export function StockResearchPage() {
  const { symbol: rawSymbol } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const symbol = rawSymbol?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9][A-Z0-9.^-]{0,31}$/.test(symbol)) {
    return <ErrorState title="Invalid stock symbol" description="Choose a stock from your Watchlist or enter a valid ticker symbol." backTo="/" />;
  }
  const activeTab = searchParams.get('tab') === 'price-volume' ? 'price-volume' : 'overview';
  const historyOpen = searchParams.get('history') === 'open' && activeTab === 'overview';

  function updateParams(tab: 'overview' | 'price-volume', openHistory = false) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (tab === 'overview') next.delete('tab'); else next.set('tab', 'price-volume');
      if (openHistory) next.set('history', 'open'); else next.delete('history');
      return next;
    });
  }

  return (
    <div className="page stock-page">
      <StockHeader symbol={symbol} />
      <Tabs
        className="stock-tabs"
        activeKey={activeTab}
        onChange={(key) => updateParams(key === 'price-volume' ? 'price-volume' : 'overview')}
        items={[
          { key: 'overview', label: 'Overview', children: <Overview onOpenHistory={() => updateParams('overview', true)} /> },
          { key: 'price-volume', label: 'Price & Volume', children: <PriceVolume /> },
        ]}
      />
      <ResearchHistoryDrawer open={historyOpen} onClose={() => updateParams('overview')} symbol={symbol} />
    </div>
  );
}
