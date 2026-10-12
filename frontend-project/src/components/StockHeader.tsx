import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { DataStatusIndicator } from './DataStatusIndicator';

export function StockHeader({ symbol }: { symbol: string }) {
  return (
    <header className="stock-header">
      <div className="stock-header__identity">
        <Link to="/" className="stock-header__back" aria-label="Back to Watchlist"><ArrowLeftOutlined /></Link>
        <span className="stock-header__symbol-badge" aria-hidden="true">{symbol.slice(0, 1)}</span>
        <div>
          <span className="eyebrow">STOCK RESEARCH</span>
          <h1>{symbol}</h1>
          <p>Instrument details will appear when the stock data API is connected.</p>
        </div>
      </div>
      <DataStatusIndicator status="none" />
    </header>
  );
}
