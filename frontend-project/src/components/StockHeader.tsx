import { ArrowLeftOutlined, SyncOutlined } from '@ant-design/icons';
import { Button, Tag } from 'antd';
import { Link } from 'react-router-dom';
import { DataStatusIndicator } from './DataStatusIndicator';
import type { StockOverview } from '../api/stocks';
import { STATUS_LABELS } from '../api/watchlist';
import { formatFinancialValue } from '../utils/format';

export function StockHeader({ overview, onSync, syncing }: { overview: StockOverview; onSync: () => void; syncing: boolean }) {
  const { stock, inWatchlist } = overview;
  const { symbol } = stock;
  return (
    <header className="stock-header">
      <div className="stock-header__identity">
        <Link to="/" className="stock-header__back" aria-label="Back to Watchlist"><ArrowLeftOutlined /></Link>
        <span className="stock-header__symbol-badge" aria-hidden="true">{symbol.slice(0, 1)}</span>
        <div>
          <span className="eyebrow">STOCK RESEARCH</span>
          <h1>{symbol}</h1>
          <p>{stock.company}</p>
          <div className="stock-header__badges"><Tag>{stock.exchange}</Tag><Tag>{stock.currency}</Tag><Tag>{inWatchlist ? `In Watchlist · ${STATUS_LABELS[stock.researchStatus]}` : 'Not in Watchlist'}</Tag></div>
        </div>
      </div>
      <div className="stock-header__market">
        <strong>{stock.lastPrice ? formatFinancialValue(stock.lastPrice.value, stock.currency) : 'N/A'}</strong>
        <span className={stock.dailyChange ? Number(stock.dailyChange.percent) > 0 ? 'market-positive' : Number(stock.dailyChange.percent) < 0 ? 'market-negative' : '' : ''}>{stock.dailyChange ? `${Number(stock.dailyChange.value) > 0 ? '+' : ''}${formatFinancialValue(stock.dailyChange.value, stock.currency)} (${Number(stock.dailyChange.percent) > 0 ? '+' : ''}${Number(stock.dailyChange.percent).toFixed(2)}%)` : 'Daily change N/A'}</span>
        <small>{stock.lastPrice ? `EOD close · ${stock.lastPrice.tradingDate} · ${stock.lastPrice.provider} · RAW` : 'No closing price stored'}</small>
        <DataStatusIndicator status={stock.lastPrice ? stock.fresh ? 'fresh' : 'stale' : 'none'} />
      </div>
      <Button onClick={onSync} loading={syncing} disabled={syncing} icon={<SyncOutlined aria-label="Synchronize" />}>Sync Data</Button>
    </header>
  );
}
