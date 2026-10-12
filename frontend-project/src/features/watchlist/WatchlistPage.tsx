import { Button } from 'antd';
import { ArrowRightOutlined, LineChartOutlined, PlusOutlined } from '@ant-design/icons';
import { EmptyState } from '../../components/States';
import { MetricCard } from '../../components/MetricCard';

export function WatchlistPage() {
  return (
    <div className="page watchlist-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">YOUR RESEARCH WORKSPACE</span>
          <h1>Watchlist</h1>
          <p>A focused place to follow the companies you choose and the research you save.</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => document.getElementById('global-stock-search')?.focus()}>
          Open a ticker
        </Button>
      </section>

      <section className="metric-grid" aria-label="Watchlist summary">
        <MetricCard label="TRACKED STOCKS" value="—" detail="Available when watchlist data is connected" icon={<LineChartOutlined />} />
        <MetricCard label="LATEST CLOSE" value="—" detail="No stored market observation" />
        <MetricCard label="RESEARCH NOTES" value="—" detail="No research history loaded" />
      </section>

      <section className="panel watchlist-panel" aria-labelledby="watchlist-panel-title">
        <div className="panel__header">
          <div><span className="eyebrow">YOUR COVERAGE</span><h2 id="watchlist-panel-title">Tracked companies</h2></div>
          <span className="panel__minor">Stocks you add will appear here</span>
        </div>
        <EmptyState
          icon={<span className="empty-state__graphic" aria-hidden="true"><LineChartOutlined /></span>}
          title="Your watchlist starts here"
          description="Open a ticker in the search above. The watchlist connection will let you save the companies you choose in a later phase."
          action={<Button icon={<ArrowRightOutlined />} onClick={() => document.getElementById('global-stock-search')?.focus()}>Open ticker search</Button>}
        />
      </section>
    </div>
  );
}
